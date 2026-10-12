import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { MockEmbeddingModelV4 } from "ai/test";
import type { Db } from "@/db/client";
import { problems, requests } from "@/db/schema";
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
import { reembedRequests, seedRequests } from "./bulk";

const extraction = {
  problemStatement: "Owners need year-end books their accountant can use.",
  underlyingProblem: "Year-end export",
  proposedSolution: "",
  persona: "Owner",
  severity: "medium",
};

let db: Db;
beforeAll(async () => {
  db = await prepareDatabase(TEST_DATABASE_URL);
});
beforeEach(async () => {
  await resetDatabase(db);
  await seedPeople(db);
});
afterAll(() => db?.$client.end());

describe("seedRequests", () => {
  test("submits every fixture request through intake as its author, in order", async () => {
    const { models } = scriptedModels({
      generate: async ({ prompt }) => {
        const [first] = candidateIds(prompt);
        return jsonResult({
          ...extraction,
          match:
            first === undefined
              ? null
              : { verdict: "same_problem", problemId: first, rationale: "r" },
        });
      },
      embed: () => axisVector(0),
    });

    const summary = await seedRequests({ db, models }, [
      {
        key: "r-1",
        authorKey: "u-01",
        title: "Year-end export",
        description: "For my accountant.",
      },
      {
        key: "r-2",
        authorKey: "u-02",
        title: "Accountant export",
        description: "Same need.",
      },
    ]);

    expect(summary).toEqual({
      submitted: 2,
      draft: 0,
      high: 1,
      medium: 0,
      low: 1,
    });
    const rows = await db.select({ title: requests.title }).from(requests);
    expect(rows.map((r) => r.title).sort()).toEqual([
      "Accountant export",
      "Year-end export",
    ]);
  });

  test("an unknown author is a fixture error", async () => {
    const { models } = scriptedModels({
      generate: async () => jsonResult(extraction),
    });

    await expect(
      seedRequests({ db, models }, [
        { key: "r-1", authorKey: "u-99", title: "x", description: "y" },
      ]),
    ).rejects.toThrow("u-99");
  });
});

describe("reembedRequests", () => {
  test("re-embeds every request with the configured model and records which one", async () => {
    const { models } = scriptedModels({
      generate: async () => jsonResult({ ...extraction, match: null }),
    });
    await seedRequests({ db, models }, [
      {
        key: "r-1",
        authorKey: "u-01",
        title: "Year-end export",
        description: "For my accountant.",
      },
    ]);
    const next = new MockEmbeddingModelV4({
      provider: "next",
      modelId: "v2",
      doEmbed: async ({ values }) => ({
        embeddings: values.map(() => axisVector(7)),
        warnings: [],
      }),
    });

    const count = await reembedRequests({
      db,
      models: { ...models, embedding: next },
    });

    expect(count).toBe(1);
    const [row] = await db
      .select({ model: requests.embeddingModel, embedding: requests.embedding })
      .from(requests);
    expect(row?.model).toBe("next:v2");
    expect(row?.embedding?.[7]).toBe(1);
    expect(await db.select().from(problems)).toHaveLength(1);
  });
});
