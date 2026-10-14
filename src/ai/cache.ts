import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { wrapEmbeddingModel, wrapLanguageModel } from "ai";
import type { Models } from "./models";

/** Where cached model responses live; a plain map, or a JSON file on disk. */
export interface ResponseStore {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

function keyOf(
  kind: string,
  model: { provider: string; modelId: string },
  params: unknown,
) {
  const hash = createHash("sha256")
    .update(JSON.stringify(params))
    .digest("hex");
  return `${kind}:${model.provider}:${model.modelId}:${hash}`;
}

/**
 * Answers repeated model calls from `store`, keyed by model and request parameters.
 * Only the JSON-safe parts of a response are kept, so the store can live on disk.
 * Each entry also keeps how long the live call took, reported to `onTime` on every call
 * (live, failed or replayed), so a replayed eval still measures latency. An entry without a time
 * (stored before times were kept) is fetched again.
 */
export function withResponseCache(
  models: Models,
  store: ResponseStore,
  onTime: (ms: number) => void = () => {},
): Models {
  async function cached<T extends object>(
    key: string,
    call: () => Promise<T>,
  ): Promise<T> {
    // Trusted: only this middleware writes these entries.
    const hit = store.get(key) as (T & { ms?: number }) | undefined;
    if (hit?.ms !== undefined) {
      const { ms, ...response } = hit;
      onTime(ms);
      return response as T;
    }
    const start = performance.now();
    const elapsed = () => Math.round(performance.now() - start);
    let response: T;
    try {
      response = await call();
    } catch (error) {
      // A failed call (e.g. a timeout) still cost the wait; it just is not stored.
      onTime(elapsed());
      throw error;
    }
    const ms = elapsed();
    store.set(key, { ...response, ms });
    onTime(ms);
    return response;
  }

  const language = (model: Models["intake"]) =>
    wrapLanguageModel({
      model,
      middleware: {
        wrapGenerate: ({ doGenerate, params, model: inner }) =>
          cached(
            keyOf("generate", inner, { ...params, abortSignal: undefined }),
            async () => {
              const { content, finishReason, usage, warnings } =
                await doGenerate();
              return { content, finishReason, usage, warnings };
            },
          ),
      },
    });

  return {
    intake: language(models.intake),
    reasoning: language(models.reasoning),
    embedding: wrapEmbeddingModel({
      model: models.embedding,
      middleware: {
        wrapEmbed: ({ doEmbed, params, model: inner }) =>
          cached(
            keyOf("embed", inner, { ...params, abortSignal: undefined }),
            async () => {
              const { embeddings, usage, warnings } = await doEmbed();
              return { embeddings, usage, warnings };
            },
          ),
      },
    }),
  };
}

/**
 * A store backed by a JSON file that several runs share (a run is a script and its models).
 * Each run records the entries it used; `save({ complete: true })` after a full run drops
 * the entries that run used before but no longer does, unless another run still needs them.
 */
export function fileStore(
  path: string,
  run: string,
): ResponseStore & { save(options?: { complete?: boolean }): void } {
  const file: {
    runs: Record<string, string[]>;
    entries: Record<string, unknown>;
  } = existsSync(path)
    ? JSON.parse(readFileSync(path, "utf8"))
    : { runs: {}, entries: {} };
  const used = new Set<string>();
  let dirty = false;
  return {
    get: (key) => {
      const hit = file.entries[key];
      if (hit !== undefined) used.add(key);
      return hit;
    },
    set: (key, value) => {
      file.entries[key] = value;
      used.add(key);
      dirty = true;
    },
    save: ({ complete = false } = {}) => {
      if (complete) {
        const previous = file.runs[run] ?? [];
        file.runs[run] = [...used].sort();
        const needed = new Set(Object.values(file.runs).flat());
        for (const key of previous)
          if (!needed.has(key)) delete file.entries[key];
        dirty = true;
      }
      if (dirty) writeFileSync(path, `${JSON.stringify(file)}\n`);
      dirty = false;
    },
  };
}
