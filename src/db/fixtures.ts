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
 * Labeled request sets the eval replays: the synthetic fixtures (also seeded into the demo),
 * or real vscode feature requests, which are eval-only.
 */
export type Dataset = "fixtures" | "vscode";
const DATASET_FILES: Record<Dataset, string[]> = {
  fixtures: ["fixtures", "requests.json"],
  vscode: ["eval", "oss", "vscode.json"],
};
export const DATASETS = ["fixtures", "vscode"] as const satisfies Dataset[];

/** A dataset's labeled requests, in submission order. */
export async function loadRequestFixtures(dataset: Dataset = "fixtures") {
  const raw = await readFile(
    join(process.cwd(), "data", ...DATASET_FILES[dataset]),
    "utf8",
  );
  return z.array(requestFixtureSchema).parse(JSON.parse(raw));
}
