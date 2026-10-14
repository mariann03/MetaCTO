import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { events, problems, requests, supports } from "@/db/schema";
import { jsonResult, scriptedModels } from "../../test/ai";
import {
  prepareDatabase,
  resetDatabase,
  TEST_DATABASE_URL,
} from "../../test/db";
import { seedPeople } from "../../test/seed";
import { editStatement, listVersions, mergeProblems } from "./curation";
import { recordDecision } from "./decisions";
import type { Deps } from "./deps";
import { refineStatement, submitRequest } from "./intake";
import { addSupport, getProblem } from "./problems";

/** Intake: every request starts its own Problem. Refinement: always proposes a new wording. */
const scripted = () =>
  scriptedModels({
    generate: async ({ prompt }) => {
      const text = JSON.stringify(prompt);
      if (text.includes("<current_statement>"))
        return jsonResult({ changed: true, statement: "AI rewording" });
      if (text.includes("<decision>"))
        return jsonResult({ body: "An update." });
      const name = /<title>(.*?)<\/title>/.exec(text)?.[1] ?? "";
      return jsonResult({
        problemStatement: `Statement for ${name}`,
        underlyingProblem: name,
        proposedSolution: "",
        persona: "Bookkeeper",
        severity: "medium",
        match: text.includes("<candidate id=")
          ? { verdict: "different", problemId: null, rationale: "New" }
          : null,
      });
    },
  });
const deps = (db: Db): Deps => ({ db, models: scripted().models });

let db: Db;
let people: Awaited<ReturnType<typeof seedPeople>>;

beforeAll(async () => {
  db = await prepareDatabase(TEST_DATABASE_URL);
});
beforeEach(async () => {
  await resetDatabase(db);
  people = await seedPeople(db);
});
afterAll(async () => {
  await db.$client.end();
});

async function submit(name: string, authorId: number) {
  const result = await submitRequest(deps(db), {
    authorId,
    title: name,
    description: "Details of the need.",
  });
  if (result.status !== "submitted") throw new Error(`${name} not submitted`);
  return result;
}
const plusOne = (userId: number, problemId: number, note: string | null) =>
  addSupport(deps(db), { userId, problemId, note, source: "explore" });

describe("mergeProblems", () => {
  test("moves requests and supports into the target, counting each supporter once", async () => {
    const target = await submit("Payroll", people.alice);
    const source = await submit("Run payroll", people.bob);
    // Alice supports both; her note on the duplicate is the only one, so it is kept.
    await plusOne(people.alice, source.problemId, "Two days a month.");

    expect(
      await mergeProblems(
        { db },
        {
          userId: people.priya,
          sourceId: source.problemId,
          targetId: target.problemId,
        },
      ),
    ).toBe("merged");

    const merged = await getProblem({ db }, people.priya, target.problemId);
    expect(merged?.requests.map((r) => r.id)).toEqual([
      target.requestId,
      source.requestId,
    ]);
    expect(merged?.supporters).toBe(2);
    expect(
      await db
        .select({ userId: supports.userId, note: supports.note })
        .from(supports)
        .orderBy(supports.userId),
    ).toEqual([
      { userId: people.alice, note: "Two days a month." },
      { userId: people.bob, note: null },
    ]);
    expect(
      await db.select().from(problems).where(eq(problems.id, source.problemId)),
    ).toEqual([]);
    expect(
      await db
        .select({ actorId: events.actorId, payload: events.payload })
        .from(events)
        .where(eq(events.type, "problem_merged")),
    ).toEqual([
      {
        actorId: people.priya,
        payload: {
          sourceId: source.problemId,
          sourceStatement: "Statement for Run payroll",
          requests: 1,
          supports: 1,
        },
      },
    ]);
  });

  test("refuses a merge into itself or a missing Problem, and a source that has a decision", async () => {
    const target = await submit("Payroll", people.alice);
    const source = await submit("Run payroll", people.bob);
    const merge = (sourceId: number, targetId: number) =>
      mergeProblems({ db }, { userId: people.priya, sourceId, targetId });

    expect(await merge(source.problemId, source.problemId)).toBe("invalid");
    expect(await merge(source.problemId, 404)).toBe("invalid");
    await recordDecision(deps(db), {
      userId: people.priya,
      problemId: source.problemId,
      status: "planned",
      rationale: "Soon.",
    });
    // Its updates and supporters' notifications would go with it.
    expect(await merge(source.problemId, target.problemId)).toBe("decided");
    expect(
      await db
        .select({ problemId: requests.problemId })
        .from(requests)
        .where(eq(requests.id, source.requestId)),
    ).toEqual([{ problemId: source.problemId }]);
  });

  test("a request being grouped into a Problem merged away meanwhile starts its own", async () => {
    const target = await submit("Payroll", people.alice);
    const source = await submit("Run payroll", people.bob);
    // While the model judges the new request same as the source, a PM merges the source away.
    const { models } = scriptedModels({
      generate: async ({ prompt }) => {
        const text = JSON.stringify(prompt);
        if (text.includes("<current_statement>"))
          return jsonResult({ changed: false, statement: "" });
        await mergeProblems(
          { db },
          {
            userId: people.priya,
            sourceId: source.problemId,
            targetId: target.problemId,
          },
        );
        return jsonResult({
          problemStatement: "Statement for More payroll",
          underlyingProblem: "More payroll",
          proposedSolution: "",
          persona: "Bookkeeper",
          severity: "medium",
          match: {
            verdict: "same_problem",
            problemId: source.problemId,
            rationale: "Same",
          },
        });
      },
    });

    const result = await submitRequest(
      { db, models },
      {
        authorId: people.alice,
        title: "More payroll",
        description: "Details of the need.",
      },
    );

    expect(result).toMatchObject({ status: "submitted", tier: "low" });
    if (result.status !== "submitted") return;
    expect([source.problemId, target.problemId]).not.toContain(
      result.problemId,
    );
  });

  test("only a PM merges", async () => {
    const target = await submit("Payroll", people.alice);
    const source = await submit("Run payroll", people.bob);

    await expect(
      mergeProblems(
        { db },
        {
          userId: people.alice,
          sourceId: source.problemId,
          targetId: target.problemId,
        },
      ),
    ).rejects.toThrow();
  });
});

describe("editStatement", () => {
  test("a PM's edit is a new version; locked, the AI never rewrites it", async () => {
    const { problemId, requestId } = await submit("Payroll", people.alice);

    await editStatement(
      { db },
      {
        userId: people.priya,
        problemId,
        statement: "Teams run payroll by hand every month.",
        locked: true,
      },
    );
    const request = {
      id: requestId,
      authorId: people.alice,
      title: "More",
      description: "Details.",
    };
    expect(await refineStatement(deps(db), problemId, request)).toBe(
      "Teams run payroll by hand every month.",
    );

    await editStatement(
      { db },
      {
        userId: people.priya,
        problemId,
        statement: "Teams run payroll by hand every month.",
        locked: false,
      },
    );
    expect(await refineStatement(deps(db), problemId, request)).toBe(
      "AI rewording",
    );
    expect(
      (await listVersions({ db }, problemId)).map((v) => [
        v.author,
        v.statement,
      ]),
    ).toEqual([
      ["ai", "AI rewording"],
      ["pm", "Teams run payroll by hand every month."],
      ["ai", "Statement for Payroll"],
    ]);
    expect(
      (
        await db
          .select({ type: events.type })
          .from(events)
          .where(eq(events.actorId, people.priya))
          .orderBy(events.id)
      ).map((e) => e.type),
    ).toEqual(["statement_edited", "statement_locked", "statement_unlocked"]);
  });

  test("only a PM edits, and never to an empty statement", async () => {
    const { problemId } = await submit("Payroll", people.alice);
    const edit = (userId: number, statement: string) =>
      editStatement({ db }, { userId, problemId, statement, locked: false });

    await expect(edit(people.alice, "Mine now.")).rejects.toThrow();
    expect(
      await editStatement(
        { db },
        {
          userId: people.priya,
          problemId: 404,
          statement: "Gone.",
          locked: false,
        },
      ),
    ).toBe("missing");
    await expect(edit(people.priya, "  ")).rejects.toThrow();
    expect((await listVersions({ db }, problemId)).length).toBe(1);
  });
});
