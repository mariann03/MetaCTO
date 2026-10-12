import { createDb } from "@/db/client";
import { loadDirectoryFixtures } from "@/db/fixtures";
import { seedDirectory } from "@/domain/directory";
import { readEnv } from "@/env";

const db = createDb(readEnv().DATABASE_URL);
try {
  await seedDirectory({ db }, await loadDirectoryFixtures());
  console.log("Seeded accounts, users and strategy.");
} finally {
  await db.$client.end();
}
