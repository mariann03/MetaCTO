// Builds an eval-only dataset of real feature requests from microsoft/vscode, whose
// maintainers mark duplicates machine-readably ("/duplicate of #N"). A labeled duplicate
// and its original share a problemKey; every other request is its own. Unlabeled duplicates
// surely exist, so precision measured on it is a lower bound. Authors are dropped and
// @mentions removed. Never loaded into the demo database.
//   GITHUB_TOKEN=$(gh auth token) bun scripts/oss-dataset.ts
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const REPO = "microsoft/vscode";
const DUPLICATES = 220;
const SINGLES = 120;
const BODY_LIMIT = 1500;

const token = z.string().min(1).parse(process.env.GITHUB_TOKEN);
const issueSchema = z.object({
  number: z.number(),
  title: z.string(),
  body: z.string().nullable(),
  created_at: z.string(),
  pull_request: z.unknown().optional(),
});
type Issue = z.infer<typeof issueSchema>;

async function github(path: string): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`https://api.github.com/${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    });
    if (res.ok) return res.json();
    // The search API allows 30 requests a minute; wait it out.
    if ((res.status === 403 || res.status === 429) && attempt < 5) {
      await Bun.sleep(30_000);
      continue;
    }
    throw new Error(`${path}: ${res.status} ${await res.text()}`);
  }
}

async function search(query: string, limit: number) {
  const found: Issue[] = [];
  for (let page = 1; found.length < limit && page <= 10; page++) {
    const { items } = z
      .object({ items: z.array(issueSchema) })
      .parse(
        await github(
          `search/issues?q=${encodeURIComponent(query)}&sort=created&order=desc&per_page=100&page=${page}`,
        ),
      );
    if (items.length === 0) break;
    found.push(...items.filter((i) => !i.pull_request));
  }
  return found.slice(0, limit);
}

/** The original a maintainer pointed a duplicate at, from its comments. */
async function originalOf(issue: number) {
  const comments = z
    .array(z.object({ body: z.string().nullable() }))
    .parse(await github(`repos/${REPO}/issues/${issue}/comments?per_page=100`));
  for (const { body } of comments) {
    const match =
      /\/duplicate\s+(?:of\s+)?(?:#|https:\/\/github\.com\/microsoft\/vscode\/issues\/)(\d+)/i.exec(
        body ?? "",
      ) ?? /Duplicate of #(\d+)/i.exec(body ?? "");
    if (match) return Number(match[1]);
  }
  return null;
}

/** Plain text a customer could have written: no markup noise, no names, bounded. */
function clean(text: string) {
  return text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/<img[^>]*>/gi, "")
    .replace(/@[\w-]+/g, "@someone")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, BODY_LIMIT);
}

const request = (issue: Issue, problemKey: string, split: string) => ({
  key: `vsc-${issue.number}`,
  problemKey,
  authorKey: "oss",
  title: clean(issue.title),
  description: clean(issue.body ?? "") || clean(issue.title),
  split,
  tags: ["oss", REPO],
});

// Whole groups go to one split, so a duplicate is never judged against a train-only original.
const splitOf = (key: string) =>
  (createHash("sha256").update(key).digest()[0] ?? 0) % 3 === 0
    ? "holdout"
    : "train";

const duplicates = await search(
  `repo:${REPO} is:issue label:feature-request label:*duplicate`,
  DUPLICATES,
);
const issues = new Map<number, Issue>();
const groupOf = new Map<number, number>();
for (const [i, dup] of duplicates.entries()) {
  const original = await originalOf(dup.number);
  if (original === null || original === dup.number) continue;
  if (!issues.has(original)) {
    const parsed = issueSchema.safeParse(
      await github(`repos/${REPO}/issues/${original}`).catch(() => null),
    );
    if (!parsed.success || parsed.data.pull_request) continue;
    issues.set(original, parsed.data);
    groupOf.set(original, original);
  }
  issues.set(dup.number, dup);
  groupOf.set(dup.number, groupOf.get(original) ?? original);
  if ((i + 1) % 20 === 0)
    console.log(`Read ${i + 1}/${duplicates.length} duplicates`);
}
// Feature requests never marked as duplicates: each its own Problem, as far as we know.
const singles = await search(
  `repo:${REPO} is:issue label:feature-request -label:*duplicate`,
  SINGLES,
);
for (const single of singles)
  if (!issues.has(single.number)) {
    issues.set(single.number, single);
    groupOf.set(single.number, single.number);
  }

const dataset = [...issues.values()]
  .sort((a, b) => a.created_at.localeCompare(b.created_at))
  .map((issue) => {
    const problemKey = `vsc-${groupOf.get(issue.number) ?? issue.number}`;
    return request(issue, problemKey, splitOf(problemKey));
  });
const dir = join(process.cwd(), "data", "eval", "oss");
mkdirSync(dir, { recursive: true });
writeFileSync(
  join(dir, "vscode.json"),
  `${JSON.stringify(dataset, null, 2)}\n`,
);
const groups = new Set(dataset.map((r) => r.problemKey)).size;
console.log(
  `Wrote data/eval/oss/vscode.json: ${dataset.length} requests, ${groups} problems, ${dataset.length - groups} labeled duplicates`,
);
