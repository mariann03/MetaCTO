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

/**
 * Labeled requests the eval replays, in submission order: the synthetic fixtures (also
 * seeded into the demo), or real vscode feature requests, which are eval-only.
 */
const DATASET_FILES = {
  fixtures: ["fixtures", "requests.json"],
  vscode: ["eval", "oss", "vscode.json"],
} as const;
export const DATASETS = Object.keys(
  DATASET_FILES,
) as (keyof typeof DATASET_FILES)[];
export type Dataset = keyof typeof DATASET_FILES;

/** A dataset's labeled requests, in submission order. */
export async function loadRequestFixtures(dataset: Dataset = "fixtures") {
  const raw = await readFile(
    join(process.cwd(), "data", ...DATASET_FILES[dataset]),
    "utf8",
  );
  return z.array(requestFixtureSchema).parse(JSON.parse(raw));
}
