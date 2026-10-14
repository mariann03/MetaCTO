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
import { events } from "@/db/schema";
import { jsonResult, scriptedModels } from "../../test/ai";
import {
  prepareDatabase,
  resetDatabase,
  TEST_DATABASE_URL,
} from "../../test/db";
import { seedPeople } from "../../test/seed";
import {
  approveUpdate,
  draftUpdates,
  listDrafts,
  listInternalUpdates,
  listNotifications,
  recordDecision,
} from "./decisions";
import type { Deps } from "./deps";
import { submitRequest } from "./intake";
import { addSupport, getProblem } from "./problems";
import { writeStrategy } from "./settings";

const STRATEGY = "Move upmarket: win Enterprise accounts.";
const NOTE = "We lose two days every month-end.";

let failDrafts = false;
// When set, draft calls wait for it, so a test can overlap two decisions.
let gate: Promise<void> | null = null;
/** Intake: every request starts its own Problem. Drafts: echo the audience they were asked for. */
const scripted = () =>
  scriptedModels({
    generate: async ({ prompt }) => {
      const text = JSON.stringify(prompt);
      if (text.includes("<decision>")) {
        if (failDrafts) throw new Error("Model down");
        const waiting = gate;
        if (waiting) await waiting;
        const why = /<rationale>(.*?)<\/rationale>/.exec(text)?.[1];
        return jsonResult({
          body: text.includes("<accounts>")
            ? "Internal: talking points"
            : `We plan to build it. ${why}`,
        });
      }
      if (text.includes("<current_statement>"))
        return jsonResult({ changed: false, statement: "" });
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
let problemId: number;

beforeAll(async () => {
  db = await prepareDatabase(TEST_DATABASE_URL);
});
beforeEach(async () => {
  failDrafts = false;
  gate = null;
  await resetDatabase(db);
  people = await seedPeople(db);
  await writeStrategy(db, STRATEGY);
  const submitted = await submitRequest(deps(db), {
    authorId: people.alice,
    title: "Payroll",
    description: "Details of the need.",
  });
  if (submitted.status !== "submitted") throw new Error("not submitted");
  problemId = submitted.problemId;
  await addSupport(deps(db), {
    userId: people.bob,
    problemId,
    note: NOTE,
    source: "explore",
  });
});
afterAll(async () => {
  await db.$client.end();
});

const decide = (models = deps(db).models, rationale = "Most asked for.") =>
  recordDecision(
    { db, models },
    { userId: people.priya, problemId, status: "planned", rationale },
  );

describe("recordDecision", () => {
  test("sets the Problem's status and public rationale, and drafts one update per audience", async () => {
    await decide();

    expect(await getProblem({ db }, people.bob, problemId)).toMatchObject({
      status: "planned",
      decision: { status: "planned", rationale: "Most asked for." },
    });
    expect(
      (await listDrafts({ db }, problemId)).map((d) => [d.audience, d.body]),
    ).toEqual([
      ["customer", "We plan to build it. Most asked for."],
      ["internal", "Internal: talking points"],
    ]);
    expect(
      await db
        .select({ actorId: events.actorId, payload: events.payload })
        .from(events)
        .where(eq(events.type, "decision_recorded")),
    ).toEqual([{ actorId: people.priya, payload: { status: "planned" } }]);
  });

  test("the customer draft is built from the statement, decision and public rationale only", async () => {
    const { models, language } = scripted();
    await decide(models);

    const prompts = language.doGenerateCalls
      .map((c) => JSON.stringify(c.prompt))
      .filter((p) => p.includes("<decision>"));
    const customer = prompts.find((p) => !p.includes("<accounts>")) ?? "";
    const internal = prompts.find((p) => p.includes("<accounts>")) ?? "";
    for (const shared of [
      "Statement for Payroll",
      "planned",
      "Most asked for.",
    ])
      expect([customer, internal].every((p) => p.includes(shared))).toBe(true);
    // Internal data: account names and ARR, the strategy, and customers' notes.
    for (const secret of ["Brightside Bakery", "4800", STRATEGY, NOTE]) {
      expect(customer).not.toContain(secret);
      expect(internal).toContain(secret);
    }
  });

  test("needs a PM, a decided status and a rationale", async () => {
    const attempt = (userId: number, status: string, rationale: string) =>
      recordDecision(deps(db), {
        userId,
        problemId,
        // @ts-expect-error: a status a PM cannot decide
        status,
        rationale,
      });

    await expect(attempt(people.alice, "planned", "Why")).rejects.toThrow();
    await expect(attempt(people.priya, "open", "Why")).rejects.toThrow();
    await expect(attempt(people.priya, "planned", " ")).rejects.toThrow();
    expect((await getProblem({ db }, people.bob, problemId))?.status).toBe(
      "open",
    );
  });

  test("when drafting fails the decision stands, and the PM drafts again", async () => {
    failDrafts = true;
    expect(await decide()).toEqual({ drafted: false });
    expect((await getProblem({ db }, people.bob, problemId))?.status).toBe(
      "planned",
    );
    expect(await listDrafts({ db }, problemId)).toEqual([]);

    failDrafts = false;
    await draftUpdates(deps(db), { userId: people.priya, problemId });
    expect(await listDrafts({ db }, problemId)).toHaveLength(2);
  });

  test("a new decision replaces the drafts nobody approved, even when drafting fails", async () => {
    await decide();
    await decide(undefined, "Changed our minds.");
    expect(
      (await listDrafts({ db }, problemId)).map((d) => d.body)[0],
    ).toContain("Changed our minds.");

    failDrafts = true;
    await decide(undefined, "Again.");
    expect(await listDrafts({ db }, problemId)).toEqual([]);
  });

  test("drafts for a decision overtaken while drafting are dropped", async () => {
    let release = () => {};
    gate = new Promise((resolve) => {
      release = resolve;
    });
    const slow = decide(undefined, "First thoughts.");
    // Let the slow drafting reach the model before the second decision.
    await Bun.sleep(50);
    gate = null;
    await decide(undefined, "Changed our minds.");
    release();
    await slow;

    const drafts = await listDrafts({ db }, problemId);
    expect(drafts).toHaveLength(2);
    expect(drafts[0]?.body).toContain("Changed our minds.");
  });
});

describe("approveUpdate", () => {
  const draft = async (audience: "customer" | "internal") => {
    const found = (await listDrafts({ db }, problemId)).find(
      (d) => d.audience === audience,
    );
    if (!found) throw new Error(`no ${audience} draft`);
    return found.id;
  };
  const approve = (updateId: number, body: string, userId = people.priya) =>
    approveUpdate({ db }, { userId, updateId, body });

  test("delivers the PM's edited customer update to every supporter and shows it on the Problem", async () => {
    await decide();
    const updateId = await draft("customer");

    expect(await approve(updateId, "Planned for next quarter.")).toBe(
      "approved",
    );
    expect(await approve(updateId, "Again.")).toBe("already_approved");
    // Drafting again leaves what was already delivered alone.
    await draftUpdates(deps(db), { userId: people.priya, problemId });
    expect(
      (await listDrafts({ db }, problemId)).map((d) => d.audience),
    ).toEqual(["internal"]);

    for (const userId of [people.alice, people.bob])
      expect(
        (await listNotifications({ db }, userId)).map((n) => n.body),
      ).toEqual(["Planned for next quarter."]);
    expect(await listNotifications({ db }, people.priya)).toEqual([]);
    expect(
      (await getProblem({ db }, people.bob, problemId))?.updates.map(
        (u) => u.body,
      ),
    ).toEqual(["Planned for next quarter."]);
    expect(await listDrafts({ db }, problemId)).toHaveLength(1);
  });

  test("an approved internal update reaches no customer", async () => {
    await decide();

    expect(await approve(await draft("internal"), "Tell Sales.")).toBe(
      "approved",
    );

    expect(await listNotifications({ db }, people.alice)).toEqual([]);
    expect((await getProblem({ db }, people.bob, problemId))?.updates).toEqual(
      [],
    );
    // The PM keeps it on the Problem to pass on to Sales and CS.
    expect(
      (await listInternalUpdates({ db }, problemId)).map((u) => u.body),
    ).toEqual(["Tell Sales."]);
  });

  test("only a PM approves, and never an empty update", async () => {
    await decide();
    const updateId = await draft("customer");

    await expect(approve(updateId, "Hi", people.alice)).rejects.toThrow();
    await expect(approve(updateId, "  ")).rejects.toThrow();
    expect(await approve(404, "Gone.")).toBe("missing");
    expect(await listNotifications({ db }, people.alice)).toEqual([]);
  });
});
