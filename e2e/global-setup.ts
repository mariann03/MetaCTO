import { loadDirectoryFixtures } from "@/db/fixtures";
import { seedDirectory } from "@/domain/directory";
import { E2E_DATABASE_URL } from "../playwright.config";
import { prepareDatabase, resetDatabase } from "../test/db";

export default async function globalSetup() {
  const db = await prepareDatabase(E2E_DATABASE_URL);
  try {
    await resetDatabase(db);
    await seedDirectory({ db }, await loadDirectoryFixtures());
  } finally {
    await db.$client.end();
  }
}
