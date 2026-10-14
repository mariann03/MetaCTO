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
import { events, requests } from "@/db/schema";
import { candidateIds, jsonResult, scriptedModels } from "../../test/ai";
import {
  prepareDatabase,
  resetDatabase,
  TEST_DATABASE_URL,
} from "../../test/db";
import { seedPeople } from "../../test/seed";
import type { Deps } from "./deps";
import { submitRequest } from "./intake";
import { listCriteria } from "./prioritization";
import { addSupport } from "./problems";
import { rank } from "./ranking";
import {
  overrideScore,
  rescoreProblem,
  rescoreStale,
  scoreProblem,
} from "./scoring";
import { updateStrategy, writeStrategy } from "./settings";

const title = (prompt: unknown) =>
  /<title>(.*?)<\/title>/.exec(JSON.stringify(prompt))?.[1] ?? "";
const requestIds = (prompt: unknown) =>
  [...JSON.stringify(prompt).matchAll(/<request id=\\"(\d+)\\"/g)].map((m) =>
    Number(m[1]),
  );

/** What the scripted model judges; cites every request it was shown unless told otherwise. */
type Judgement = { value: number; cite?: number[] };
let judged: Record<"strategicFit" | "urgency" | "effort", Judgement>;

/**
 * Intake: each title is its own Problem, except that the same title joins it. Scoring:
 * answers with `judged`.
 */
const scripted = () =>
  scriptedModels({
    generate: async ({ prompt }) => {
      const text = JSON.stringify(prompt);
      if (text.includes("<current_statement>"))
        return jsonResult({ changed: false, statement: "" });
      if (text.includes("<strategy>")) {
        const shown = requestIds(prompt);
        const judgement = ({ value, cite }: Judgement) => ({
          rationale: `Rated ${value}`,
          score: value,
          citedRequestIds: cite ?? shown,
        });
        return jsonResult({
          strategicFit: judgement(judged.strategicFit),
          urgency: judgement(judged.urgency),
          effort: judgement(judged.effort),
        });
      }
      const name = title(prompt);
      const asked = candidateIds(prompt).length > 0;
      // The candidate stating the same need, if any.
      const problemId = [
        ...text.matchAll(/<candidate id=\\"(\d+)\\">(.*?)<\/candidate>/g),
      ].find((m) => m[2] === `Statement for ${name}`)?.[1];
      return jsonResult({
        problemStatement: `Statement for ${name}`,
        underlyingProblem: name,
        proposedSolution: "",
        persona: "Bookkeeper",
        severity: "medium",
        match: !asked
          ? null
          : problemId
            ? {
                verdict: "same_problem",
                problemId: Number(problemId),
                rationale: "Same",
              }
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
  await writeStrategy(db, "Move upmarket: win Enterprise accounts.");
  judged = {
    strategicFit: { value: 4 },
    urgency: { value: 5 },
    effort: { value: 2 },
  };
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
  return { problemId: result.problemId, requestId: result.requestId };
}

const judgedOf = async (problemId: number) =>
  (await listCriteria({ db })).find((p) => p.id === problemId)?.judged;

describe("scoreProblem", () => {
  test("judges Strategic fit, Urgency and Effort against the strategy, citing the Problem's requests", async () => {
    const { problemId, requestId } = await submit("Payroll");
    const { models, language } = scripted();

    await scoreProblem({ db, models }, problemId);

    const call = language.doGenerateCalls.at(-1);
    const prompt = JSON.stringify(call?.prompt);
    expect(prompt).toContain("Move upmarket: win Enterprise accounts.");
    expect(prompt).toContain("Statement for Payroll");
    expect(requestIds(call?.prompt)).toEqual([requestId]);
    expect(call?.reasoning).toBe("none");
    const ai = (value: number) => ({
      value,
      ai: value,
      rationale: `Rated ${value}`,
      citedRequestIds: [requestId],
      stale: false,
      override: null,
    });
    expect(await judgedOf(problemId)).toEqual({
      strategicFit: ai(4),
      urgency: ai(5),
      effort: ai(2),
    });
  });

  test("a citation of a request outside the Problem fails the scoring and stores nothing", async () => {
    const { problemId } = await submit("Payroll");
    judged.urgency = { value: 5, cite: [999] };

    await expect(scoreProblem(deps(db), problemId)).rejects.toThrow();

    expect(await judgedOf(problemId)).toEqual({
      strategicFit: null,
      urgency: null,
      effort: null,
    });
  });
});

describe("staleness", () => {
  const stale = async (problemId: number) =>
    (await judgedOf(problemId))?.urgency?.stale;
  const plusOne = (problemId: number, note: string | null) =>
    addSupport(deps(db), {
      userId: people.bob,
      problemId,
      note,
      source: "explore",
    });

  test("new evidence makes a score stale: a request joining the Problem, or a +1 with a note", async () => {
    const payroll = (await submit("Payroll")).problemId;
    const receipts = (await submit("Receipts")).problemId;
    await scoreProblem(deps(db), payroll);
    await scoreProblem(deps(db), receipts);

    expect(await submit("Payroll", people.bob)).toMatchObject({
      problemId: payroll,
    });
    expect(await stale(payroll)).toBe(true);

    await plusOne(receipts, "Every month-end we retype receipts.");
    expect(await stale(receipts)).toBe(true);

    await scoreProblem(deps(db), payroll);
    expect(await stale(payroll)).toBe(false);
  });

  test("a request leaving the Problem (e.g. moved by a review) makes it stale too", async () => {
    const payroll = (await submit("Payroll")).problemId;
    const receipts = (await submit("Receipts")).problemId;
    const { requestId } = await submit("Payroll", people.bob);
    await scoreProblem(deps(db), payroll);
    await scoreProblem(deps(db), receipts);

    await db
      .update(requests)
      .set({ problemId: receipts })
      .where(eq(requests.id, requestId));

    expect([await stale(payroll), await stale(receipts)]).toEqual([true, true]);
  });

  test("a plain +1 is not new evidence", async () => {
    const { problemId } = await submit("Payroll");
    await scoreProblem(deps(db), problemId);

    await plusOne(problemId, null);

    expect(await stale(problemId)).toBe(false);
  });

  test("a PM's strategy change makes every score stale, and is recorded", async () => {
    const payroll = (await submit("Payroll")).problemId;
    const receipts = (await submit("Receipts")).problemId;
    await scoreProblem(deps(db), payroll);
    await scoreProblem(deps(db), receipts);
    // It takes no models: nothing rescores until a PM asks.
    await updateStrategy(
      { db },
      { userId: people.priya, strategy: "Win mid-market accounts." },
    );

    expect([await stale(payroll), await stale(receipts)]).toEqual([true, true]);
    expect(
      await db
        .select({ actorId: events.actorId })
        .from(events)
        .where(eq(events.type, "strategy_updated")),
    ).toEqual([{ actorId: people.priya }]);
  });

  test("only a PM changes the strategy", async () => {
    await expect(
      updateStrategy({ db }, { userId: people.alice, strategy: "Mine." }),
    ).rejects.toThrow();
  });
});

describe("overrideScore", () => {
  test("a PM's override, with its reason, replaces the AI score in the ranking and survives a rescore", async () => {
    const payroll = (await submit("Payroll")).problemId;
    const receipts = (await submit("Receipts")).problemId;
    judged.urgency = { value: 4 };
    await scoreProblem(deps(db), payroll);
    judged.urgency = { value: 2 };
    await scoreProblem(deps(db), receipts);
    const byUrgency = async () =>
      rank(await listCriteria({ db }), {
        reach: 0,
        businessValue: 0,
        strategicFit: 0,
        urgency: 1,
        effort: 0,
      }).map((p) => p.id);
    expect(await byUrgency()).toEqual([payroll, receipts]);

    expect(
      await overrideScore(
        { db },
        {
          userId: people.priya,
          problemId: receipts,
          criterion: "urgency",
          value: 5,
          reason: "Two enterprise renewals hinge on it.",
        },
      ),
    ).toBe("overridden");

    expect(await byUrgency()).toEqual([receipts, payroll]);
    await rescoreProblem(deps(db), {
      userId: people.priya,
      problemId: receipts,
    });
    expect((await judgedOf(receipts))?.urgency).toMatchObject({
      value: 5,
      ai: 2,
      override: { value: 5, reason: "Two enterprise renewals hinge on it." },
    });
    expect(
      await db
        .select({ actorId: events.actorId, payload: events.payload })
        .from(events)
        .where(eq(events.type, "score_overridden")),
    ).toEqual([
      {
        actorId: people.priya,
        payload: {
          criterion: "urgency",
          value: 5,
          ai: 2,
          reason: "Two enterprise renewals hinge on it.",
        },
      },
    ]);
  });

  test("needs a PM, a reason and a score to override", async () => {
    const { problemId } = await submit("Payroll");
    const override = (userId: number, reason: string) =>
      overrideScore(
        { db },
        { userId, problemId, criterion: "effort", value: 1, reason },
      );

    expect(await override(people.priya, "Already built.")).toBe("unscored");
    await scoreProblem(deps(db), problemId);
    await expect(override(people.alice, "Already built.")).rejects.toThrow();
    await expect(override(people.priya, "  ")).rejects.toThrow();
    await expect(
      overrideScore(
        { db },
        {
          userId: people.priya,
          problemId,
          criterion: "effort",
          value: 6,
          reason: "Off the scale.",
        },
      ),
    ).rejects.toThrow();
    expect((await judgedOf(problemId))?.effort?.override).toBeNull();
  });
});

describe("rescoreStale", () => {
  test("scores the stale and the never-scored Problems, leaving fresh ones alone", async () => {
    const fresh = (await submit("Payroll")).problemId;
    const stale = (await submit("Receipts")).problemId;
    const unscored = (await submit("Taxes")).problemId;
    await scoreProblem(deps(db), fresh);
    await scoreProblem(deps(db), stale);
    await submit("Receipts", people.bob);
    const { models, language } = scripted();

    expect(
      await rescoreStale({ db, models }, { userId: people.priya }),
    ).toEqual({ scored: 2, failed: 0 });

    const scored = language.doGenerateCalls.map(
      (c) => /<problem>(.*?)<\/problem>/.exec(JSON.stringify(c.prompt))?.[1],
    );
    expect(scored.toSorted()).toEqual([
      "Statement for Receipts",
      "Statement for Taxes",
    ]);
    for (const id of [fresh, stale, unscored])
      expect((await judgedOf(id))?.urgency?.stale).toBe(false);
  });

  test("only a PM spends on rescoring", async () => {
    await expect(
      rescoreStale(deps(db), { userId: people.alice }),
    ).rejects.toThrow();
  });
});
