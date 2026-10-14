// Rebuilds the demo database: directory first, then every fixture request through intake, then
// AI scores for every Problem.
// Model answers come from data/cache when present, so a re-seed is fast and offline.
import { createCachedModels } from "@/ai/cached-models";
import { createDb } from "@/db/client";
import { loadDirectoryFixtures, loadRequestFixtures } from "@/db/fixtures";
import { resetDatabase } from "@/db/reset";
import { problems } from "@/db/schema";
import { seedRequests } from "@/domain/bulk";
import { seedDirectory } from "@/domain/directory";
import { scoreProblem } from "@/domain/scoring";
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
  const all = await db.select({ id: problems.id }).from(problems);
  for (const [i, { id }] of all.entries()) {
    await scoreProblem({ db, models }, id);
    if ((i + 1) % 10 === 0 || i + 1 === all.length) {
      save();
      console.log(`Scored ${i + 1}/${all.length} problems`);
    }
  }
  save({ complete: true });
  console.log("Seed complete:", summary);
} finally {
  save();
  await db.$client.end();
}
