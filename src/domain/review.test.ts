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
import {
  EMBEDDING_DIMENSIONS,
  events,
  problems,
  problemVersions,
  requests,
  supports,
} from "@/db/schema";
import {
  axisVector,
  candidateIds,
  jsonResult,
  scriptedModels,
} from "../../test/ai";
import {
  prepareDatabase,
  resetDatabase,
  TEST_DATABASE_URL,
} from "../../test/db";
import { seedPeople } from "../../test/seed";
import type { Deps } from "./deps";
import { listMyRequests, requestSplit, submitRequest } from "./intake";
import { listReviewQueue, reviewRequest } from "./review";

/** Unit vector at `similarity` to the first request (axis 0), leaning along its own `axis`. */
function towardOriginal(similarity: number, axis: number): number[] {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) =>
    i === 0 ? similarity : i === axis ? Math.sqrt(1 - similarity ** 2) : 0,
  );
}

const title = (prompt: unknown) =>
  /<title>(.*?)<\/title>/.exec(JSON.stringify(prompt))?.[1] ?? "";

/**
 * Intake by title: "Close", "Mid" and "Far" requests resemble "Original" at 0.9, 0.6 and 0.3
 * and are judged the same need; "Other" is judged different. Each statement names its request.
 */
const deps = (db: Db): Deps => ({
  db,
  models: scriptedModels({
    embed: (text) =>
      text.startsWith("Close")
        ? towardOriginal(0.9, 2)
        : text.startsWith("Mid")
          ? towardOriginal(0.6, 3)
          : text.startsWith("Far")
            ? towardOriginal(0.3, 4)
            : text.startsWith("Other")
              ? axisVector(7)
              : axisVector(0),
    generate: async ({ prompt }) => {
      const name = title(prompt);
      if (JSON.stringify(prompt).includes("<current_statement>"))
        return jsonResult({ changed: true, statement: `Refined with ${name}` });
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
            : name.startsWith("Other")
              ? {
                  verdict: "different",
                  problemId: null,
                  rationale: "Not alike",
                }
              : { verdict: "same_problem", problemId, rationale: "Same need" },
      });
    },
  }).models,
});

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
  return result;
}

const statementOf = async (problemId: number) =>
  (
    await db
      .select({ statement: problems.statement })
      .from(problems)
      .where(eq(problems.id, problemId))
  )[0]?.statement;

const eventsOf = (type: string) =>
  db
    .select({ actorId: events.actorId, payload: events.payload })
    .from(events)
    .where(eq(events.type, type));

describe("listReviewQueue", () => {
  test("holds what the AI was unsure about, with its evidence", async () => {
    const original = await submit("Original need");
    const close = await submit("Close need", people.bob);
    await submit("Mid need", people.bob);
    await submit("Far need", people.bob);
    await submit("Other need", people.bob);
    const confident = await submit("Close need too", people.bob);
    await requestSplit(deps(db), {
      userId: people.bob,
      requestId: close.requestId,
    });

    const queue = await listReviewQueue(deps(db));

    expect(confident.tier).toBe("high");
    // Oldest first; the confident grouping nobody disputed needs no review.
    expect(queue.map((i) => [i.title, i.reason, i.signalsDisagree])).toEqual([
      ["Original need", "new_problem", false],
      ["Close need", "split_requested", false],
      ["Mid need", "grouping", false],
      ["Far need", "grouping", true],
      ["Other need", "new_problem", false],
    ]);
    const mid = queue[2];
    expect(mid?.problem).toEqual({
      id: original.problemId,
      statement: "Refined with Close need too",
    });
    expect(mid?.match).toEqual({
      verdict: "same_problem",
      problemId: original.problemId,
      rationale: "Same need",
    });
    expect(mid?.candidates).toEqual([
      {
        problemId: original.problemId,
        similarity: expect.closeTo(0.6, 5),
        statement: "Refined with Close need too",
      },
    ]);
  });
});

describe("reviewRequest", () => {
  const accept = { action: "accept" } as const;

  test("accepting a grouping marks it reviewed and folds the request into the statement", async () => {
    const original = await submit("Original need");
    const mid = await submit("Mid need", people.bob);

    expect(
      await reviewRequest(deps(db), {
        userId: people.priya,
        requestId: mid.requestId,
        decision: accept,
      }),
    ).toBe("reviewed");

    expect((await listReviewQueue(deps(db))).map((i) => i.title)).toEqual([
      "Original need",
    ]);
    expect(await statementOf(original.problemId)).toBe("Refined with Mid need");
    expect(await eventsOf("review_accepted")).toEqual([
      {
        actorId: people.priya,
        payload: { problemId: original.problemId },
      },
    ]);
    expect(await eventsOf("grouping_overridden")).toEqual([]);
  });

  test("accepting a new Problem keeps its statement, and a locked statement is never refined", async () => {
    const original = await submit("Original need");
    const mid = await submit("Mid need", people.bob);
    await db
      .update(problems)
      .set({ statementLocked: true })
      .where(eq(problems.id, original.problemId));

    for (const requestId of [original.requestId, mid.requestId])
      await reviewRequest(deps(db), {
        userId: people.priya,
        requestId,
        decision: accept,
      });

    expect(await statementOf(original.problemId)).toBe(
      "Statement for Original need",
    );
    expect(await listReviewQueue(deps(db))).toEqual([]);
  });

  test("moving reassigns the request and its support, and records an override", async () => {
    const original = await submit("Original need");
    const other = await submit("Other need", people.bob);

    await reviewRequest(deps(db), {
      userId: people.priya,
      requestId: other.requestId,
      decision: { action: "move", problemId: original.problemId },
    });

    const [moved] = await db
      .select({ problemId: requests.problemId })
      .from(requests)
      .where(eq(requests.id, other.requestId));
    expect(moved?.problemId).toBe(original.problemId);
    expect(
      await db
        .select({ problemId: supports.problemId })
        .from(supports)
        .where(eq(supports.userId, people.bob)),
    ).toEqual([{ problemId: original.problemId }]);
    // The new Problem it started has nothing left, so it is gone.
    expect(await statementOf(other.problemId)).toBeUndefined();
    expect(await eventsOf("grouping_overridden")).toEqual([
      {
        actorId: people.priya,
        payload: {
          action: "move",
          fromProblemId: other.problemId,
          toProblemId: original.problemId,
        },
      },
    ]);
  });

  test("a moved request's author keeps supporting the old Problem through their other request there", async () => {
    const original = await submit("Original need");
    const other = await submit("Other need");
    const mid = await submit("Mid need", people.bob);
    const far = await submit("Far need", people.bob);

    await reviewRequest(deps(db), {
      userId: people.priya,
      requestId: mid.requestId,
      decision: { action: "move", problemId: other.problemId },
    });

    expect(
      await db
        .select({
          problemId: supports.problemId,
          requestId: supports.requestId,
        })
        .from(supports)
        .where(eq(supports.userId, people.bob))
        .orderBy(supports.problemId),
    ).toEqual([
      { problemId: original.problemId, requestId: far.requestId },
      { problemId: other.problemId, requestId: mid.requestId },
    ]);
  });

  test("splitting starts a new Problem from the request, recorded as an override", async () => {
    const original = await submit("Original need");
    const mid = await submit("Mid need", people.bob);

    await reviewRequest(deps(db), {
      userId: people.priya,
      requestId: mid.requestId,
      decision: { action: "split" },
    });

    const [split] = await db
      .select({ problemId: requests.problemId })
      .from(requests)
      .where(eq(requests.id, mid.requestId));
    const problemId = split?.problemId ?? 0;
    expect(problemId).not.toBe(original.problemId);
    expect(await statementOf(problemId)).toBe("Statement for Mid need");
    expect(
      await db
        .select({ statement: problemVersions.statement })
        .from(problemVersions)
        .where(eq(problemVersions.problemId, problemId)),
    ).toEqual([{ statement: "Statement for Mid need" }]);
    expect(
      await db
        .select({ problemId: supports.problemId })
        .from(supports)
        .where(eq(supports.userId, people.bob)),
    ).toEqual([{ problemId }]);
    expect(await eventsOf("grouping_overridden")).toEqual([
      {
        actorId: people.priya,
        payload: {
          action: "split",
          fromProblemId: original.problemId,
          toProblemId: problemId,
        },
      },
    ]);
    // The PM made the new Problem, so it needs no review of its own.
    expect((await listReviewQueue(deps(db))).map((i) => i.title)).toEqual([
      "Original need",
    ]);
  });

  test("only a PM reviews, each item once, and a reviewed grouping can no longer be disputed", async () => {
    await submit("Original need");
    const mid = await submit("Mid need", people.bob);
    const review = (userId: number) =>
      reviewRequest(deps(db), {
        userId,
        requestId: mid.requestId,
        decision: accept,
      });

    await expect(review(people.alice)).rejects.toThrow("Only a PM");
    expect(await review(people.priya)).toBe("reviewed");
    expect(await review(people.priya)).toBe("already_reviewed");
    const [mine] = await listMyRequests(deps(db), people.bob);
    expect(mine?.canSplit).toBe(false);
  });
});
