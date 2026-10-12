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

/** A store backed by a JSON file; call `save()` to write new entries back. */
export function fileStore(path: string): ResponseStore & { save(): void } {
  const entries: Record<string, unknown> = existsSync(path)
    ? JSON.parse(readFileSync(path, "utf8"))
    : {};
  let dirty = false;
  return {
    get: (key) => entries[key],
    set: (key, value) => {
      entries[key] = value;
      dirty = true;
    },
    save: () => {
      if (dirty) writeFileSync(path, `${JSON.stringify(entries)}\n`);
      dirty = false;
    },
  };
}
