// Re-embeds every request with the configured EMBEDDING_MODEL (after switching models).
import { createModels } from "@/ai/models";
import { createDb } from "@/db/client";
import { reembedRequests } from "@/domain/bulk";
import { readEnv } from "@/env";

const env = readEnv();
const db = createDb(env.DATABASE_URL);
try {
  const count = await reembedRequests({ db, models: createModels(env) });
  console.log(`Re-embedded ${count} requests with ${env.EMBEDDING_MODEL}.`);
  console.log("Run `bun run eval` to tune thresholds for this model.");
} finally {
  await db.$client.end();
}
