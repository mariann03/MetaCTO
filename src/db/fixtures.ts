import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { DirectoryFixtures } from "@/domain/directory";

export const FIXTURES_DIR = join(process.cwd(), "data", "fixtures");

export async function loadDirectoryFixtures(
  dir = FIXTURES_DIR,
): Promise<DirectoryFixtures> {
  const read = (file: string) => readFile(join(dir, file), "utf8");
  return {
    accounts: JSON.parse(await read("accounts.json")),
    users: JSON.parse(await read("users.json")),
    strategy: await read("strategy.md"),
  };
}
