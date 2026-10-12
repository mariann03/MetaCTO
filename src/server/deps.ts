import "server-only";
import { createFakeModels } from "@/ai/fake";
import { createModels } from "@/ai/models";
import { createDb } from "@/db/client";
import type { Deps } from "@/domain/deps";
import { readEnv } from "@/env";

function createDeps(): Deps {
  const env = readEnv();
  return {
    db: createDb(env.DATABASE_URL),
    models: env.E2E_FAKE_AI ? createFakeModels() : createModels(env),
  };
}

const globalForDeps = globalThis as unknown as { deps?: Deps };

// One pool per server process; reused across hot reloads in dev.
globalForDeps.deps ??= createDeps();

export const deps: Deps = globalForDeps.deps;
