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
 */
export function withResponseCache(
  models: Models,
  store: ResponseStore,
): Models {
  const language = (model: Models["intake"]) =>
    wrapLanguageModel({
      model,
      middleware: {
        wrapGenerate: async ({ doGenerate, params, model: inner }) => {
          const key = keyOf("generate", inner, {
            ...params,
            abortSignal: undefined,
          });
          const hit = store.get(key);
          // Trusted: only this middleware writes these entries.
          if (hit) return hit as Awaited<ReturnType<typeof doGenerate>>;
          const { content, finishReason, usage, warnings } = await doGenerate();
          const kept = { content, finishReason, usage, warnings };
          store.set(key, kept);
          return kept;
        },
      },
    });

  return {
    intake: language(models.intake),
    reasoning: language(models.reasoning),
    embedding: wrapEmbeddingModel({
      model: models.embedding,
      middleware: {
        wrapEmbed: async ({ doEmbed, params, model: inner }) => {
          const key = keyOf("embed", inner, {
            ...params,
            abortSignal: undefined,
          });
          const hit = store.get(key);
          // Trusted: only this middleware writes these entries.
          if (hit) return hit as Awaited<ReturnType<typeof doEmbed>>;
          const { embeddings, usage, warnings } = await doEmbed();
          const kept = { embeddings, usage, warnings };
          store.set(key, kept);
          return kept;
        },
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
