// Rebuilds the demo database: directory first, then every fixture request through intake.
// Model answers come from data/cache when present, so a re-seed is fast and offline.
import { createCachedModels } from "@/ai/cached-models";
import { createDb } from "@/db/client";
import { loadDirectoryFixtures, loadRequestFixtures } from "@/db/fixtures";
import { resetDatabase } from "@/db/reset";
import { seedRequests } from "@/domain/bulk";
import { seedDirectory } from "@/domain/directory";
import { readEnv } from "@/env";

const env = readEnv();
const db = createDb(env.DATABASE_URL);
const { models, save } = createCachedModels(env, "seed");
try {
  await resetDatabase(db);
  await seedDirectory({ db }, await loadDirectoryFixtures());
  const summary = await seedRequests(
    { db, models },
    await loadRequestFixtures(),
    (done, total) => {
      if (done % 10 === 0 || done === total) {
        save();
        console.log(`Seeded ${done}/${total} requests`);
      }
    },
  );
  save({ complete: true });
  console.log("Seed complete:", summary);
} finally {
  save();
  await db.$client.end();
}
