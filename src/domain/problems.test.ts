import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { EMBEDDING_DIMENSIONS, events, problems, supports } from "@/db/schema";
import { candidateIds, jsonResult, scriptedModels } from "../../test/ai";
import {
  prepareDatabase,
  resetDatabase,
  TEST_DATABASE_URL,
} from "../../test/db";
import { seedPeople } from "../../test/seed";
import type { Deps } from "./deps";
import { submitRequest } from "./intake";
import {
  addSupport,
  findMatches,
  getProblem,
  listProblems,
  searchProblems,
} from "./problems";

/** Unit vector with these components on the first axes. */
function vector(...components: number[]): number[] {
  const norm = Math.hypot(...components);
  return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) =>
    i < components.length ? (components[i] ?? 0) / norm : 0,
  );
}

// Requests by title; the query resembles them at about .65, .58, .54, .43 and .32.
const VECTORS: Record<string, number[]> = {
  "Invoices A": vector(1),
  "Invoices B": vector(0.9, 0, 0.436),
  Payroll: vector(0, 0, 0, 1),
  Receipts: vector(0, 0, 0, 0, 1),
  Taxes: vector(0, 0, 0, 0, 0, 1),
  Query: vector(0.6, 0, 0, 0.5, 0.4, 0.3),
};

const title = (prompt: unknown) =>
  /<title>(.*?)<\/title>/.exec(JSON.stringify(prompt))?.[1] ?? "";

/** "Invoices" requests are judged the same need; everything else starts its own Problem. */
const scripted = () =>
  scriptedModels({
    embed: (text) => VECTORS[text.split("\n")[0] ?? ""] ?? vector(0, 1),
    generate: async ({ prompt }) => {
      const name = title(prompt);
      if (JSON.stringify(prompt).includes("<current_statement>"))
        return jsonResult({ changed: false, statement: "" });
      const [problemId] = candidateIds(prompt);
      return jsonResult({
        problemStatement: `Statement for ${name}`,
        underlyingProblem: name,
        proposedSolution: "",
        persona: "Bookkeeper",
        severity: "medium",
        match:
          problemId === undefined
            ? null
            : name.startsWith("Invoices")
              ? { verdict: "same_problem", problemId, rationale: "Same need" }
              : { verdict: "different", problemId: null, rationale: "New" },
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

async function submit(name: string, authorId = people.alice) {
  const result = await submitRequest(deps(db), {
    authorId,
    title: name,
    description: "Details of the need.",
  });
  if (result.status !== "submitted")
    throw new Error(`${name} was not submitted: ${result.status}`);
  return result.problemId;
}

describe("findMatches", () => {
  test("offers the 3 closest Problems, each at its best-matching request, with supporters", async () => {
    const invoices = await submit("Invoices A");
    expect(await submit("Invoices B", people.bob)).toBe(invoices);
    const payroll = await submit("Payroll");
    const receipts = await submit("Receipts");
    await submit("Taxes");
    await addSupport(deps(db), {
      userId: people.priya,
      problemId: payroll,
      note: null,
      source: "explore",
    });

    const { models, language } = scripted();
    const matches = await findMatches(
      { db, models },
      {
        viewerId: people.bob,
        title: "Query",
        description: "What I typed so far.",
      },
    );

    // Embedding only: it runs while the user types, so no LLM call.
    expect(language.doGenerateCalls).toHaveLength(0);

    expect(matches).toEqual([
      {
        id: invoices,
        statement: "Statement for Invoices A",
        status: "open",
        supporters: 2,
        supported: true,
        similarity: expect.closeTo(0.647, 2),
      },
      {
        id: payroll,
        statement: "Statement for Payroll",
        status: "open",
        supporters: 2,
        supported: false,
        similarity: expect.closeTo(0.539, 2),
      },
      {
        id: receipts,
        statement: "Statement for Receipts",
        status: "open",
        supporters: 1,
        supported: false,
        similarity: expect.closeTo(0.431, 2),
      },
    ]);
  });

  test("finds nothing before any Problem exists", async () => {
    expect(
      await findMatches(deps(db), {
        viewerId: people.bob,
        title: "Query",
        description: "What I typed so far.",
      }),
    ).toEqual([]);
  });
});

describe("getProblem", () => {
  test("shows the Problem with its requests, oldest first, naming only each customer's segment", async () => {
    const invoices = await submit("Invoices A");
    expect(await submit("Invoices B", people.priya)).toBe(invoices);

    expect(await getProblem(deps(db), people.bob, invoices)).toEqual({
      id: invoices,
      statement: "Statement for Invoices A",
      status: "open",
      supporters: 2,
      supported: false,
      requests: [
        {
          id: expect.any(Number),
          title: "Invoices A",
          description: "Details of the need.",
          segment: "smb",
        },
        // Priya belongs to no account.
        {
          id: expect.any(Number),
          title: "Invoices B",
          description: "Details of the need.",
          segment: null,
        },
      ],
    });
  });

  test("finds nothing for an unknown Problem", async () => {
    expect(await getProblem(deps(db), people.bob, 404)).toBeNull();
  });
});

describe("searchProblems", () => {
  test("ranks Problems by meaning, each at its closest request, within a status", async () => {
    const invoices = await submit("Invoices A");
    await submit("Invoices B", people.bob);
    const payroll = await submit("Payroll");
    const receipts = await submit("Receipts");
    await db
      .update(problems)
      .set({ status: "planned" })
      .where(eq(problems.id, receipts));
    const { models, language } = scripted();
    const search = (status?: "planned") =>
      searchProblems(
        { db, models },
        { viewerId: people.bob, query: "Query", status },
      );

    // "Query" shares no words with the requests; only their meaning is close.
    expect((await search()).map((p) => p.id)).toEqual([
      invoices,
      payroll,
      receipts,
    ]);
    expect(await search("planned")).toEqual([
      {
        id: receipts,
        statement: "Statement for Receipts",
        status: "planned",
        supporters: 1,
        supported: false,
        similarity: expect.closeTo(0.431, 2),
      },
    ]);
    expect(language.doGenerateCalls).toHaveLength(0);
  });
});

describe("addSupport", () => {
  test("adds one support per user, keeps its note as evidence, and records the deflection", async () => {
    const problemId = await submit("Payroll");
    const plusOne = (note: string | null) =>
      addSupport(deps(db), {
        userId: people.bob,
        problemId,
        note,
        source: "submit",
      });

    expect(await plusOne("We run payroll for 40 people by hand.")).toBe(
      "added",
    );
    expect(await plusOne("Second thoughts.")).toBe("already_supported");

    expect(
      await db
        .select({ userId: supports.userId, note: supports.note })
        .from(supports)
        .where(eq(supports.problemId, problemId))
        .orderBy(supports.userId),
    ).toEqual([
      { userId: people.alice, note: null },
      { userId: people.bob, note: "We run payroll for 40 people by hand." },
    ]);
    expect(
      await db
        .select({ type: events.type, actorId: events.actorId })
        .from(events)
        .where(inArray(events.type, ["request_deflected", "support_added"])),
    ).toEqual([{ type: "request_deflected", actorId: people.bob }]);
  });

  test("the author of a request already supports its Problem", async () => {
    const problemId = await submit("Payroll");

    expect(
      await addSupport(deps(db), {
        userId: people.alice,
        problemId,
        note: null,
        source: "explore",
      }),
    ).toBe("already_supported");
  });

  test("a Problem that no longer exists cannot be supported", async () => {
    expect(
      await addSupport(deps(db), {
        userId: people.bob,
        problemId: 999_999,
        note: null,
        source: "explore",
      }),
    ).toBe("missing");
  });
});

describe("listProblems", () => {
  test("lists every Problem, or those with one status, most supported first, marking the viewer's", async () => {
    const payroll = await submit("Payroll");
    const receipts = await submit("Receipts");
    await addSupport(deps(db), {
      userId: people.bob,
      problemId: receipts,
      note: null,
      source: "explore",
    });
    await db
      .update(problems)
      .set({ status: "planned" })
      .where(eq(problems.id, payroll));

    expect(await listProblems(deps(db), people.bob)).toEqual([
      {
        id: receipts,
        statement: "Statement for Receipts",
        status: "open",
        supporters: 2,
        supported: true,
      },
      {
        id: payroll,
        statement: "Statement for Payroll",
        status: "planned",
        supporters: 1,
        supported: false,
      },
    ]);
    expect(
      (await listProblems(deps(db), people.bob, "planned")).map((p) => p.id),
    ).toEqual([payroll]);
  });
});
