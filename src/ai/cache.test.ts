import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { embed, generateText } from "ai";
import { MockEmbeddingModelV4, MockLanguageModelV4 } from "ai/test";
import { fileStore, type ResponseStore, withResponseCache } from "./cache";
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

  test("reports how long each call took live, also when answered from the store", async () => {
    const slow = new MockLanguageModelV4({
      provider: "test",
      modelId: "slow",
      doGenerate: async () => {
        await Bun.sleep(30);
        return jsonResult({ ok: true });
      },
    });
    const m = { ...models().models, intake: slow };
    const times: number[] = [];
    const cached = withResponseCache(m, memoryStore(), (ms) => times.push(ms));

    await generateText({ model: cached.intake, prompt: "hi" });
    await generateText({ model: cached.intake, prompt: "hi" });
    await embed({ model: cached.embedding, value: "invoice" });

    expect(times).toHaveLength(3);
    expect(times[0]).toBeGreaterThanOrEqual(30);
    // The replay reports the live call's time, not its own.
    expect(times[1]).toBe(times[0] ?? -1);
    expect(slow.doGenerateCalls).toHaveLength(1);
  });

  test("a failed call reports the time it cost and stores nothing", async () => {
    const failing = new MockLanguageModelV4({
      provider: "test",
      modelId: "failing",
      doGenerate: async () => {
        await Bun.sleep(30);
        throw new Error("timed out");
      },
    });
    const store = memoryStore();
    const times: number[] = [];
    const cached = withResponseCache(
      { ...models().models, intake: failing },
      store,
      (ms) => times.push(ms),
    );

    await expect(
      generateText({ model: cached.intake, prompt: "hi", maxRetries: 0 }),
    ).rejects.toThrow();

    expect(times).toHaveLength(1);
    expect(times[0]).toBeGreaterThanOrEqual(25);
    expect(store.dump()).toEqual({});
  });

  test("an entry stored without its time is fetched again", async () => {
    const { language, models: m } = models();
    const store = memoryStore();
    await generateText({
      model: withResponseCache(m, store).intake,
      prompt: "hi",
    });
    const untimed = Object.fromEntries(
      Object.entries(store.dump()).map(([key, value]) => {
        const { ms: _, ...rest } = value as { ms?: number };
        return [key, rest];
      }),
    );

    await generateText({
      model: withResponseCache(m, memoryStore(untimed)).intake,
      prompt: "hi",
    });

    expect(language.doGenerateCalls).toHaveLength(2);
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

describe("fileStore", () => {
  test("a completed run drops the entries it no longer uses, unless another run needs them", () => {
    const path = join(mkdtempSync(join(tmpdir(), "cache-")), "cache.json");
    /** One script run: reads `keys` (writing the missing ones), then completes. */
    const run = (name: string, keys: string[]) => {
      const store = fileStore(path, name);
      for (const key of keys) if (!store.get(key)) store.set(key, key);
      store.save({ complete: true });
    };

    run("seed", ["shared", "old-seed"]);
    run("eval", ["shared", "eval"]);
    run("seed", ["seed"]);

    const store = fileStore(path, "any");
    expect(
      ["shared", "old-seed", "eval", "seed"].map((k) => store.get(k)),
    ).toEqual(["shared", undefined, "eval", "seed"]);
  });

  test("an interrupted run keeps every entry", () => {
    const path = join(mkdtempSync(join(tmpdir(), "cache-")), "cache.json");
    const first = fileStore(path, "seed");
    first.set("a", 1);
    first.save({ complete: true });
    const interrupted = fileStore(path, "seed");
    interrupted.set("b", 2);
    interrupted.save();

    const store = fileStore(path, "seed");
    expect([store.get("a"), store.get("b")]).toEqual([1, 2]);
  });
});
