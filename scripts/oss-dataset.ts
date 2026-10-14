// Builds an eval-only dataset of real feature requests from microsoft/vscode, whose
// maintainers mark duplicates with a command ("/duplicate of #N"). A labeled duplicate and
// its original share a problemKey; every other request is its own. Unlabeled duplicates
// surely exist, so precision measured on it is a lower bound. Nobody is named: authors are
// dropped, and handles, profile links, emails, home paths and sign-offs are scrubbed; issue
// references are removed too, so no request points at its answer. Never loaded into the
// demo database.
//   GITHUB_TOKEN=$(gh auth token) bun run dataset:vscode
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import ms from "ms";
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

/** A GitHub API response; null for a missing issue (deleted or transferred). */
async function github(path: string): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`https://api.github.com/${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    });
    if (res.ok) return res.json();
    if (res.status === 404 || res.status === 410) return null;
    // Rate limited (the search API allows 30 requests a minute): wait as told, then retry.
    const retryAfter = Number(res.headers.get("retry-after"));
    const limited =
      res.status === 429 || res.headers.get("x-ratelimit-remaining") === "0";
    if (limited && attempt < 5) {
      await Bun.sleep(retryAfter > 0 ? retryAfter * 1000 : ms("60s"));
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

/**
 * The original a maintainer pointed a duplicate at with the /duplicate command; the last
 * one wins, as it is what closed the issue. Casual "duplicate of #N" remarks do not count.
 */
async function originalOf(issue: number) {
  // ponytail: the first 100 comments only; page further if a command hides past them.
  const comments = z
    .array(z.object({ body: z.string().nullable() }))
    .parse(
      (await github(`repos/${REPO}/issues/${issue}/comments?per_page=100`)) ??
        [],
    );
  let original: number | null = null;
  for (const { body } of comments)
    for (const match of (body ?? "").matchAll(
      /^\s*\/duplicate\s+(?:of\s+)?(?:#|https:\/\/github\.com\/microsoft\/vscode\/issues\/)(\d+)/gim,
    ))
      original = Number(match[1]);
  return original;
}

/** Plain text a customer could have written: no markup noise, no names, bounded. */
function clean(text: string) {
  return (
    text
      // Cut first, so scrubbing also covers whatever the cut leaves half-written.
      .slice(0, BODY_LIMIT)
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/<img[^>]*>/gi, "")
      // Attachments and issue references: links that name people or point at the answer.
      .replace(/https?:\/\/github\.com\/user-attachments\/\S+/gi, "")
      .replace(/Originally posted by [^\n]*/gi, "")
      .replace(
        /https?:\/\/github\.com\/microsoft\/vscode\/(issues|pull)\/\d+\S*/gi,
        "an earlier issue",
      )
      .replace(/(^|[^\w&])#\d+\b/g, "$1an earlier issue")
      // People: emails, profile and fork links, @handles (in text or URLs), home folders.
      .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "someone@example.com")
      .replace(/github\.com\/(?!microsoft\b)[\w-]+/gi, "github.com/someone")
      .replace(/\/@[\w.-]+/g, "/@someone")
      .replace(/(^|[\s(])@[A-Za-z\d-]+(?![\w/-]|\.\w)/g, "$1@someone")
      .replace(/(\/Users|\/home|\\Users)([\\/])[\w.-]+/g, "$1$2someone")
      // The one-word name under a sign-off, wherever it sits.
      .replace(
        /(\n\s*(?:Best|Thanks|Regards|Cheers|Kind regards)[^\n]{0,30}\r?\n)\s*[A-Za-z][\w-]{1,20}\s*(?=\r?\n|$)/gi,
        "$1",
      )
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

const request = (
  issue: Issue,
  problemKey: string,
  split: "train" | "holdout",
) => ({
  key: `vsc-${issue.number}`,
  problemKey,
  authorKey: "oss",
  title: clean(issue.title),
  description: clean(issue.body ?? "") || clean(issue.title),
  split,
  tags: ["oss", REPO],
});

// Whole groups go to one split, so a duplicate is never judged against a train-only original.
const splitOf = (key: string): "train" | "holdout" =>
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
    const fetched = await github(`repos/${REPO}/issues/${original}`);
    // A missing original (deleted or transferred) leaves nothing to group with.
    if (fetched === null) continue;
    const parsed = issueSchema.parse(fetched);
    if (parsed.pull_request) continue;
    issues.set(original, parsed);
  }
  issues.set(dup.number, dup);
  groupOf.set(dup.number, original);
  if ((i + 1) % 20 === 0)
    console.log(`Read ${i + 1}/${duplicates.length} duplicates`);
}
// Feature requests never marked as duplicates: each its own Problem, as far as we know.
const singles = await search(
  `repo:${REPO} is:issue label:feature-request -label:*duplicate`,
  SINGLES,
);
for (const single of singles)
  if (!issues.has(single.number)) issues.set(single.number, single);

/** Follows duplicate-of links to the first original, so a chain stays one Problem. */
function rootOf(issue: number) {
  const seen = new Set<number>();
  let at = issue;
  while (groupOf.has(at) && !seen.has(at)) {
    seen.add(at);
    at = groupOf.get(at) ?? at;
  }
  return at;
}

const dataset = [...issues.values()]
  .sort((a, b) => a.created_at.localeCompare(b.created_at))
  .map((issue) => {
    const problemKey = `vsc-${rootOf(issue.number)}`;
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
