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
import { jsonResult, scriptedModels } from "../../test/ai";
import {
  prepareDatabase,
  resetDatabase,
  TEST_DATABASE_URL,
} from "../../test/db";
import { seedPeople } from "../../test/seed";
import { askClarifyingQuestions } from "./clarify";
import { submitRequest } from "./intake";
import {
  getMaxClarifyingQuestions,
  setMaxClarifyingQuestions,
} from "./settings";

const SOLUTION = {
  title: "Zapier integration",
  description: "Please add a Zapier integration.",
};
const QUESTIONS = [
  "What would you connect through Zapier?",
  "What do you do by hand today?",
  "How often does it happen?",
];

/** Clarifying: a solution without a need gets all three questions. Intake: a new Problem. */
const scripted = () =>
  scriptedModels({
    generate: async ({ prompt }) => {
      const text = JSON.stringify(prompt);
      if (text.includes("clarifying question")) {
        const needMissing = !text.includes("by hand");
        return jsonResult({
          needMissing,
          questions: needMissing ? QUESTIONS : [],
        });
      }
      return jsonResult({
        problemStatement: "Teams retype data between tools.",
        underlyingProblem: "Manual data entry.",
        proposedSolution: "Zapier",
        persona: "Ops",
        severity: "medium",
        match: null,
      });
    },
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

describe("askClarifyingQuestions", () => {
  test("asks one question by default when a request names a solution but not the need", async () => {
    const { models, language } = scripted();

    expect(await askClarifyingQuestions({ db, models }, SOLUTION)).toEqual(
      QUESTIONS.slice(0, 1),
    );
    expect(language.doGenerateCalls[0]?.reasoning).toBe("none");
  });

  test("asks nothing when the request already says why", async () => {
    expect(
      await askClarifyingQuestions(
        { db, models: scripted().models },
        {
          title: "Zapier integration",
          description: "We retype invoices by hand into Sheets every Friday.",
        },
      ),
    ).toEqual([]);
  });

  test("asks at most the PM's limit, and with zero never calls the model", async () => {
    await setMaxClarifyingQuestions({ db }, { userId: people.priya, max: 2 });
    expect(
      await askClarifyingQuestions({ db, models: scripted().models }, SOLUTION),
    ).toEqual(QUESTIONS.slice(0, 2));

    await setMaxClarifyingQuestions({ db }, { userId: people.priya, max: 0 });
    const { models, language } = scripted();
    expect(await askClarifyingQuestions({ db, models }, SOLUTION)).toEqual([]);
    expect(language.doGenerateCalls).toHaveLength(0);
  });
});

describe("setMaxClarifyingQuestions", () => {
  test("a PM sets it from 0 to 3, recorded as an event; others cannot", async () => {
    expect(await getMaxClarifyingQuestions({ db })).toBe(1);

    await setMaxClarifyingQuestions({ db }, { userId: people.priya, max: 3 });

    expect(await getMaxClarifyingQuestions({ db })).toBe(3);
    await expect(
      setMaxClarifyingQuestions({ db }, { userId: people.priya, max: 4 }),
    ).rejects.toThrow();
    await expect(
      setMaxClarifyingQuestions({ db }, { userId: people.alice, max: 0 }),
    ).rejects.toThrow();
    expect(
      await db
        .select({ payload: events.payload })
        .from(events)
        .where(eq(events.type, "max_clarifying_questions_changed")),
    ).toEqual([{ payload: { max: 3 } }]);
  });
});

describe("submitting with clarifications", () => {
  test("answers are stored with the request and given to the intake analysis", async () => {
    const { models, language } = scripted();

    const result = await submitRequest(
      { db, models },
      {
        authorId: people.alice,
        ...SOLUTION,
        clarifications: [
          {
            question: QUESTIONS[1] ?? "",
            answer: "We retype every invoice into Sheets.",
          },
        ],
      },
    );

    if (result.status !== "submitted") throw new Error("not submitted");
    const [stored] = await db
      .select({ clarifications: requests.clarifications })
      .from(requests)
      .where(eq(requests.id, result.requestId));
    expect(stored?.clarifications).toEqual([
      {
        question: "What do you do by hand today?",
        answer: "We retype every invoice into Sheets.",
      },
    ]);
    const analyzed = JSON.stringify(language.doGenerateCalls.at(-1)?.prompt);
    expect(analyzed).toContain("We retype every invoice into Sheets.");
  });

  test("a skipped question leaves the request and its analysis as without one", async () => {
    const { models, language } = scripted();

    const result = await submitRequest(
      { db, models },
      { authorId: people.alice, ...SOLUTION },
    );

    if (result.status !== "submitted") throw new Error("not submitted");
    const [stored] = await db
      .select({ clarifications: requests.clarifications })
      .from(requests)
      .where(eq(requests.id, result.requestId));
    expect(stored?.clarifications).toEqual([]);
    expect(
      JSON.stringify(language.doGenerateCalls.at(-1)?.prompt),
    ).not.toContain("<clarifications>");
  });
});
