import { join } from "node:path";
import type { Env } from "@/env";
import { fileStore, withResponseCache } from "./cache";
import { createModels } from "./models";

/** Committed cache of model responses, so seeding and the eval replay offline. */
export const RESPONSE_CACHE = join(
  process.cwd(),
  "data",
  "cache",
  "model-responses.json",
);

/** The configured models behind the response cache; call `save()` to persist new answers. */
export function createCachedModels(env: Env) {
  const store = fileStore(RESPONSE_CACHE);
  return {
    models: withResponseCache(createModels(env), store),
    save: store.save,
  };
}
