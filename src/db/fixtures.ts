import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type DirectoryFixtures,
  parseDirectoryFixtures,
} from "@/domain/directory";

export async function loadDirectoryFixtures(): Promise<DirectoryFixtures> {
  const read = (file: string) =>
    readFile(join(process.cwd(), "data", "fixtures", file), "utf8");
  return parseDirectoryFixtures({
    accounts: JSON.parse(await read("accounts.json")),
    users: JSON.parse(await read("users.json")),
    strategy: await read("strategy.md"),
  });
}
