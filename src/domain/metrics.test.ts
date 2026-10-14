import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import type { Db } from "@/db/client";
import { events } from "@/db/schema";
import {
  prepareDatabase,
  resetDatabase,
  TEST_DATABASE_URL,
} from "../../test/db";
import { seedPeople } from "../../test/seed";
import { computeMetrics } from "./metrics";

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

const T0 = Date.parse("2026-10-01T09:00:00Z");
const minutes = (n: number) => new Date(T0 + n * 60_000);

/** Appends one event, at `at` minutes after T0. */
function log(
  type: string,
  at: number,
  entity: { type: string; id: number },
  extra: {
    actor?: "user" | "pm" | "ai";
    actorId?: number;
    payload?: Record<string, unknown>;
  } = {},
) {
  return db.insert(events).values({
    type,
    actor: extra.actor ?? "ai",
    actorId: extra.actorId,
    entityType: entity.type,
    entityId: entity.id,
    payload: extra.payload ?? {},
    createdAt: minutes(at),
  });
}
const request = (id: number) => ({ type: "request", id });
const problem = (id: number) => ({ type: "problem", id });

describe("computeMetrics", () => {
  test("computes every metric from a known event log", async () => {
    const user = { actor: "user" as const, actorId: people.alice };
    const pm = { actor: "pm" as const, actorId: people.priya };
    // Request 1 starts Problem 10; the PM accepts it as new 30 minutes later.
    await log("request_submitted", 0, request(1), user);
    await log("problem_created", 0, problem(10), { payload: { requestId: 1 } });
    await log("review_accepted", 30, request(1), {
      ...pm,
      payload: { problemId: 10 },
    });
    // Request 2 is grouped into Problem 10 with high confidence, and nobody touches it.
    await log("request_submitted", 60, request(2), user);
    await log("request_grouped", 61, request(2), {
      payload: { problemId: 10, tier: "high" },
    });
    // Request 3 is grouped with high confidence too, but the PM moves it elsewhere.
    await log("request_submitted", 120, request(3), user);
    await log("request_grouped", 121, request(3), {
      payload: { problemId: 10, tier: "high" },
    });
    await log("grouping_overridden", 150, request(3), {
      ...pm,
      payload: { action: "move", fromProblemId: 10, toProblemId: 11 },
    });
    // Request 4 starts Problem 11, a duplicate of 10 the PM merges away later.
    await log("request_submitted", 180, request(4), user);
    await log("problem_created", 180, problem(11), {
      payload: { requestId: 4 },
    });
    await log("problem_merged", 300, problem(10), {
      ...pm,
      payload: { sourceId: 11, requests: 2, supports: 2 },
    });
    // Someone +1s Problem 10 from the submit page instead of filing a fifth request.
    await log("request_deflected", 200, problem(10), user);
    // Problem 10's supporters hear back 12 hours after it was created.
    await log("update_approved", 720, problem(10), {
      ...pm,
      payload: { audience: "customer" },
    });
    await log("update_approved", 730, problem(10), {
      ...pm,
      payload: { audience: "customer" },
    });
    await log("update_approved", 10, problem(11), {
      ...pm,
      payload: { audience: "internal" },
    });
    // Problem 10 is scored (three criteria) and one score overridden, twice.
    await log("problem_scored", 400, problem(10));
    for (const at of [410, 420])
      await log("score_overridden", at, problem(10), {
        ...pm,
        payload: { criterion: "urgency" },
      });
    // Request 5's analysis fails; resubmitted, it starts Problem 12, which the PM's review
    // moves into Problem 10: another duplicate the AI missed.
    await log("request_submitted", 500, request(5), user);
    await log("analysis_failed", 501, request(5));
    await log("request_submitted", 600, request(5), user);
    await log("problem_created", 600, problem(12), {
      payload: { requestId: 5 },
    });
    await log("grouping_overridden", 630, request(5), {
      ...pm,
      payload: { action: "move", fromProblemId: 12, toProblemId: 10 },
    });

    expect(await computeMetrics({ db })).toEqual({
      // 1 of 6 needs was a +1 instead of a new request (request 5 counts once).
      deflection: { count: 1, of: 6, rate: 1 / 6 },
      // Of the 3 Problems the AI created, 11 was merged away and 12's request moved out.
      missedDuplicates: { count: 2, of: 3, rate: 2 / 3 },
      // Of 2 high-tier groupings, request 2 was never touched.
      handsOff: { count: 1, of: 2, rate: 0.5 },
      // Request 1 by the PM's review (30 min), 2 and 3 by a high-tier grouping (1 min each,
      // even though 3 was moved later), 5 by the review 130 min after its first submission;
      // 4 is still waiting for review.
      timeToTriaged: { count: 4, medianMinutes: 15.5 },
      // Only Problem 10 has a customer update: its first, 720 minutes after creation.
      timeToFirstUpdate: { count: 1, medianMinutes: 720 },
      overrides: {
        // Two moves and the merge, out of 5 AI grouping decisions (2 groupings, 3 new Problems).
        groupings: { count: 3, of: 5, rate: 0.6 },
        // One criterion overridden (twice), of the 3 scored.
        scores: { count: 1, of: 3, rate: 1 / 3 },
      },
    });
  });

  test("with no events, every rate and median is unknown", async () => {
    const none = { count: 0, of: 0, rate: null };
    expect(await computeMetrics({ db })).toEqual({
      deflection: none,
      missedDuplicates: none,
      handsOff: none,
      timeToTriaged: { count: 0, medianMinutes: null },
      timeToFirstUpdate: { count: 0, medianMinutes: null },
      overrides: { groupings: none, scores: none },
    });
  });
});
