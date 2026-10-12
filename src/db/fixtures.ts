import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
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

const requestFixtureSchema = z.strictObject({
  key: z.string().min(1),
  problemKey: z.string().nullable(),
  authorKey: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  split: z.enum(["train", "holdout"]),
  tags: z.array(z.string()),
});

/** The labeled fixture requests, in submission order. */
export async function loadRequestFixtures() {
  const raw = await readFile(
    join(process.cwd(), "data", "fixtures", "requests.json"),
    "utf8",
  );
  return z.array(requestFixtureSchema).parse(JSON.parse(raw));
}
