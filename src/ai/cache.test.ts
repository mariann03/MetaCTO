import { describe, expect, test } from "bun:test";
import { embed, generateText } from "ai";
import { MockEmbeddingModelV4, MockLanguageModelV4 } from "ai/test";
import { type ResponseStore, withResponseCache } from "./cache";
import { jsonResult } from "./fake";

/** In-memory store; `dump` is what a file-backed store would write to disk. */
function memoryStore(initial: Record<string, unknown> = {}) {
  const map = new Map(Object.entries(initial));
  const store: ResponseStore = {
    get: (key) => map.get(key),
    set: (key, value) => {
      map.set(key, value);
    },
  };
  return { ...store, dump: () => Object.fromEntries(map) };
}

function models() {
  const language = new MockLanguageModelV4({
    provider: "test",
    modelId: "lm",
    doGenerate: async () => jsonResult({ ok: true }),
  });
  const embedding = new MockEmbeddingModelV4({
    provider: "test",
    modelId: "emb",
    doEmbed: async ({ values }) => ({
      embeddings: values.map((v) => [v.length, 1]),
      warnings: [],
    }),
  });
  return {
    language,
    embedding,
    models: { intake: language, reasoning: language, embedding },
  };
}

describe("withResponseCache", () => {
  test("a repeated language call is answered from the store", async () => {
    const { language, models: m } = models();
    const store = memoryStore();
    const cached = withResponseCache(m, store);

    const first = await generateText({ model: cached.intake, prompt: "hi" });
    const second = await generateText({ model: cached.intake, prompt: "hi" });

    expect(second.text).toBe(first.text);
    expect(language.doGenerateCalls).toHaveLength(1);
  });

  test("different prompts are cached separately", async () => {
    const { language, models: m } = models();
    const cached = withResponseCache(m, memoryStore());

    await generateText({ model: cached.intake, prompt: "a" });
    await generateText({ model: cached.intake, prompt: "b" });

    expect(language.doGenerateCalls).toHaveLength(2);
  });

  test("a repeated embedding is answered from the store", async () => {
    const { embedding, models: m } = models();
    const cached = withResponseCache(m, memoryStore());

    const first = await embed({ model: cached.embedding, value: "invoice" });
    const second = await embed({ model: cached.embedding, value: "invoice" });

    expect(second.embedding).toEqual(first.embedding);
    expect(embedding.doEmbedCalls).toHaveLength(1);
  });

  test("cached responses survive a JSON round trip, as when read back from disk", async () => {
    const { language, models: m } = models();
    const store = memoryStore();
    await generateText({
      model: withResponseCache(m, store).intake,
      prompt: "hi",
    });

    const reloaded = memoryStore(JSON.parse(JSON.stringify(store.dump())));
    const result = await generateText({
      model: withResponseCache(m, reloaded).intake,
      prompt: "hi",
    });

    expect(result.text).toBe(JSON.stringify({ ok: true }));
    expect(language.doGenerateCalls).toHaveLength(1);
  });

  test("the cached model keeps the provider and model id it wraps", () => {
    const { models: m } = models();
    const cached = withResponseCache(m, memoryStore());
    expect([cached.embedding.provider, cached.embedding.modelId]).toEqual([
      "test",
      "emb",
    ]);
  });
});
