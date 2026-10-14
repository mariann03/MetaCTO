import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { events } from "@/db/schema";
import { jsonResult, scriptedModels } from "../../test/ai";
import {
  prepareDatabase,
  resetDatabase,
  TEST_DATABASE_URL,
} from "../../test/db";
import { seedPeople } from "../../test/seed";
import { generateBrief, getLatestBrief, lastBriefFailure } from "./brief";
import { submitRequest } from "./intake";
import { writeStrategy } from "./settings";

type Generate = Parameters<typeof scriptedModels>[0]["generate"];
type Result = Awaited<ReturnType<Generate>>;

/** A model step that calls the named tools. */
const callTools = (...names: string[]): Result => ({
  content: names.map((toolName, i) => ({
    type: "tool-call",
    toolCallId: `call-${i}`,
    toolName,
    input: "{}",
  })),
  finishReason: { unified: "tool-calls", raw: undefined },
  usage: jsonResult({}).usage,
  warnings: [],
});
const TOOLS = [
  "get_problem",
  "list_requests",
  "get_accounts",
  "get_strategy_doc",
  "find_related_problems",
  "get_score_history",
];

/** Intake: each request its own Problem. */
const intake: Generate = async ({ prompt }) => {
  const name = /<title>(.*?)<\/title>/.exec(JSON.stringify(prompt))?.[1] ?? "";
  return jsonResult({
    problemStatement: `Statement for ${name}`,
    underlyingProblem: name,
    proposedSolution: "",
    persona: "Bookkeeper",
    severity: "medium",
    match: JSON.stringify(prompt).includes("<candidate id=")
      ? { verdict: "different", problemId: null, rationale: "New" }
      : null,
  });
};

let db: Db;
let people: Awaited<ReturnType<typeof seedPeople>>;
let problemId: number;
let requestId: number;

beforeAll(async () => {
  db = await prepareDatabase(TEST_DATABASE_URL);
});
beforeEach(async () => {
  await resetDatabase(db);
  people = await seedPeople(db);
  await writeStrategy(db, "Move upmarket.");
  const submitted = await submitRequest(
    { db, models: scriptedModels({ generate: intake }).models },
    {
      authorId: people.alice,
      title: "Payroll",
      description: "We run payroll by hand every month.",
    },
  );
  if (submitted.status !== "submitted") throw new Error("not submitted");
  ({ problemId, requestId } = submitted);
});
afterAll(async () => {
  await db.$client.end();
});

/** A brief citing what the tools returned, or `cite` in place of the request. */
const briefCiting = (cite: string) => ({
  statement: {
    text: "Bookkeepers run payroll by hand.",
    sources: [`problem:${problemId}`],
  },
  whoIsAsking: [
    { text: "One SMB account, $4,800 ARR.", sources: ["account:1"] },
  ],
  quotes: [{ quote: "We run payroll by hand every month.", source: cite }],
  scores: [
    {
      text: "Not scored yet.",
      sources: [`problem:${problemId}`, "score:history"],
    },
  ],
  options: [
    { text: "Automate payroll runs.", sources: [cite] },
    { text: "Import payroll from a provider.", sources: ["strategy"] },
  ],
  risks: [{ text: "One account so far.", sources: ["account:1"] }],
});

/** Every row the agent could read, to show it changed nothing. */
const snapshot = async () =>
  (
    await db.execute(sql`
      select (select json_agg(p order by id) from problems p) as problems,
             (select json_agg(r order by id) from requests r) as requests,
             (select json_agg(s order by id) from supports s) as supports,
             (select json_agg(a order by id) from accounts a) as accounts,
             (select json_agg(s order by key) from settings s) as settings,
             (select json_agg(s order by id) from scores s) as scores,
             (select json_agg(d order by id) from decisions d) as decisions,
             (select json_agg(v order by id) from problem_versions v) as versions`)
  ).rows[0];

describe("generateBrief", () => {
  test("gathers evidence with read-only tools and stores a brief whose claims cite them", async () => {
    let step = 0;
    const { models, language } = scriptedModels({
      generate: async () =>
        step++ === 0
          ? callTools(...TOOLS)
          : jsonResult(briefCiting(`request:${requestId}`)),
    });
    const before = await snapshot();

    const status = await generateBrief(
      { db, models },
      { userId: people.priya, problemId },
    );

    expect(status).toBe("generated");
    // The second step saw what the tools returned: the request, its account, the strategy.
    const seen = JSON.stringify(language.doGenerateCalls[1]?.prompt);
    for (const evidence of [
      "We run payroll by hand every month.",
      "Brightside Bakery",
      "Move upmarket.",
      // Reach and Business value, for the score breakdown.
      '"arr":4800',
    ])
      expect(seen).toContain(evidence);
    expect(language.doGenerateCalls[0]?.reasoning).toBe("provider-default");
    expect((await getLatestBrief({ db }, problemId))?.content).toEqual(
      briefCiting(`request:${requestId}`),
    );
    expect(await snapshot()).toEqual(before);
    expect(
      await db
        .select({ actorId: events.actorId })
        .from(events)
        .where(eq(events.type, "brief_generated")),
    ).toEqual([{ actorId: people.priya }]);
  });

  test("a claim citing a source the tools never returned fails the brief", async () => {
    let step = 0;
    const { models } = scriptedModels({
      generate: async () =>
        step++ === 0
          ? callTools(...TOOLS)
          : jsonResult(briefCiting("request:999")),
    });

    expect(
      await generateBrief({ db, models }, { userId: people.priya, problemId }),
    ).toBe("failed");
    expect(await getLatestBrief({ db }, problemId)).toBeNull();
  });

  test("an agent that never stops calling tools is cut off and fails", async () => {
    const { models, language } = scriptedModels({
      generate: async () => callTools("get_problem"),
    });

    expect(
      await generateBrief({ db, models }, { userId: people.priya, problemId }),
    ).toBe("failed");
    expect(language.doGenerateCalls).toHaveLength(8);
  });

  test("on Ollama, the tools run without the brief's schema and a final call writes it", async () => {
    // Ollama enforces a response schema on decoding, so a step that carries one can't call tools.
    let step = 0;
    const { models, language } = scriptedModels({
      provider: "ollama",
      generate: async () => {
        step++;
        if (step === 1) return callTools(...TOOLS);
        if (step === 2) return jsonResult({});
        return jsonResult(briefCiting(`request:${requestId}`));
      },
    });

    expect(
      await generateBrief({ db, models }, { userId: people.priya, problemId }),
    ).toBe("generated");
    const [gather, done, write] = language.doGenerateCalls;
    for (const call of [gather, done])
      expect(call?.responseFormat?.type).not.toBe("json");
    expect(write?.responseFormat?.type).toBe("json");
    // Writing to a schema, the model thinks only while gathering: qwen otherwise answers empty.
    expect(write?.reasoning).toBe("none");
    expect(write?.tools ?? []).toEqual([]);
    expect(JSON.stringify(write?.prompt)).toContain(
      "We run payroll by hand every month.",
    );
    expect((await getLatestBrief({ db }, problemId))?.content).toEqual(
      briefCiting(`request:${requestId}`),
    );
  });

  test("on Ollama, an agent that never stops calling tools fails without writing", async () => {
    const { models, language } = scriptedModels({
      provider: "ollama",
      generate: async () => callTools("get_problem"),
    });

    expect(
      await generateBrief({ db, models }, { userId: people.priya, problemId }),
    ).toBe("failed");
    expect(language.doGenerateCalls).toHaveLength(8);
  });

  test("a brief with an empty claim or quote fails", async () => {
    for (const empty of [
      { statement: { text: "", sources: [`problem:${problemId}`] } },
      { quotes: [{ quote: "", source: `request:${requestId}` }] },
    ]) {
      let step = 0;
      const { models } = scriptedModels({
        generate: async () =>
          step++ === 0
            ? callTools(...TOOLS)
            : jsonResult({ ...briefCiting(`request:${requestId}`), ...empty }),
      });

      expect(
        await generateBrief(
          { db, models },
          { userId: people.priya, problemId },
        ),
      ).toBe("failed");
    }
    expect(await getLatestBrief({ db }, problemId)).toBeNull();
  });

  test("keeps only quotes copied from the request they cite", async () => {
    let step = 0;
    const brief = {
      ...briefCiting(`request:${requestId}`),
      quotes: [
        { quote: "payroll by hand", source: `request:${requestId}` },
        {
          quote: "Payroll is our biggest pain.",
          source: `request:${requestId}`,
        },
        { quote: "Move upmarket.", source: "strategy" },
      ],
    };
    const { models } = scriptedModels({
      generate: async () =>
        step++ === 0 ? callTools(...TOOLS) : jsonResult(brief),
    });

    expect(
      await generateBrief({ db, models }, { userId: people.priya, problemId }),
    ).toBe("generated");
    expect((await getLatestBrief({ db }, problemId))?.content.quotes).toEqual([
      { quote: "payroll by hand", source: `request:${requestId}` },
    ]);
  });

  test("a failed run is reported until a brief succeeds", async () => {
    let step = 0;
    const { models } = scriptedModels({
      generate: async () =>
        step++ === 0
          ? callTools(...TOOLS)
          : jsonResult(briefCiting("request:999")),
    });
    await generateBrief({ db, models }, { userId: people.priya, problemId });

    expect(await getLatestBrief({ db }, problemId)).toBeNull();
    expect(await lastBriefFailure({ db }, problemId)).toBeInstanceOf(Date);
  });

  test("only a PM generates a brief", async () => {
    const { models } = scriptedModels({ generate: intake });
    await expect(
      generateBrief({ db, models }, { userId: people.alice, problemId }),
    ).rejects.toThrow();
  });
});
