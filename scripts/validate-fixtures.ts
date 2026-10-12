// Validates data/fixtures. Run: bun scripts/validate-fixtures.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { accountFixtureSchema, userFixtureSchema } from "@/domain/directory";

const DIR = join(import.meta.dir, "..", "data", "fixtures");
const errors: string[] = [];
const check = (ok: boolean, msg: string) => {
  if (!ok) errors.push(msg);
};

const TAGS = [
  "solution_shaped",
  "paraphrase",
  "false_friend",
  "vague",
  "verbose",
  "injection",
  "internal",
] as const;
type Tag = (typeof TAGS)[number];

// Eval-only shapes; accounts and users reuse the seed's table-derived schemas.
const problemSchema = z.strictObject({
  key: z.string().min(1),
  statement: z.string().min(1),
  area: z.string().min(1),
  notes: z.string().min(1),
});
const requestSchema = z.strictObject({
  key: z.string().min(1),
  problemKey: z.string().nullable(),
  authorKey: z.string(),
  title: z.string().min(1),
  description: z.string().min(1),
  split: z.enum(["train", "holdout"]),
  tags: z.array(z.enum(TAGS)),
});

/** Reads a JSON array file and keeps only items that match the schema. */
function load<S extends z.ZodType>(file: string, schema: S): z.infer<S>[] {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(DIR, file), "utf8"));
  } catch (e) {
    errors.push(`${file}: ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
  if (!Array.isArray(raw)) {
    errors.push(`${file}: not an array`);
    return [];
  }
  return raw.flatMap((item: unknown, i) => {
    const parsed = schema.safeParse(item);
    if (parsed.success) return [parsed.data];
    errors.push(`${file}[${i}]: ${z.prettifyError(parsed.error)}`);
    return [];
  });
}

const accounts = load("accounts.json", accountFixtureSchema);
const users = load("users.json", userFixtureSchema);
const problems = load("problems.json", problemSchema);
const requests = load("requests.json", requestSchema);

let strategyWords = 0;
try {
  strategyWords = readFileSync(join(DIR, "strategy.md"), "utf8").split(
    /\s+/,
  ).length;
} catch {
  errors.push("strategy.md missing");
}

// Counts
check(accounts.length === 30, `expected 30 accounts, got ${accounts.length}`);
check(problems.length === 20, `expected 20 problems, got ${problems.length}`);
check(requests.length === 150, `expected 150 requests, got ${requests.length}`);
const pms = users.filter((u) => u.role === "pm");
check(pms.length === 2, `expected 2 PMs, got ${pms.length}`);

// Unique keys
for (const [name, list] of [
  ["accounts", accounts],
  ["users", users],
  ["problems", problems],
  ["requests", requests],
] as const) {
  const keys = list.map((x) => x.key);
  check(new Set(keys).size === keys.length, `${name}: duplicate keys`);
}

// References
const accountByKey = new Map(accounts.map((a) => [a.key, a]));
const userByKey = new Map(users.map((u) => [u.key, u]));
const problemKeys = new Set(problems.map((p) => p.key));
for (const u of users) {
  if (u.accountKey !== null)
    check(
      accountByKey.has(u.accountKey),
      `${u.key}: unknown account ${u.accountKey}`,
    );
}
for (const a of accounts) {
  const n = users.filter((u) => u.accountKey === a.key).length;
  check(n >= 1 && n <= 3, `${a.key}: ${n} submitters (want 1-3)`);
}

for (const r of requests) {
  const author = userByKey.get(r.authorKey);
  check(author?.role === "submitter", `${r.key}: author not a submitter`);
  check(
    r.problemKey === null || problemKeys.has(r.problemKey),
    `${r.key}: unknown problem ${r.problemKey}`,
  );
  if (author && r.tags.includes("internal"))
    check(author.accountKey === null, `${r.key}: internal from customer`);
}

// Per-problem counts and split coverage
const rows = problems.map((p) => {
  const rs = requests.filter((r) => r.problemKey === p.key);
  const train = rs.filter((r) => r.split === "train").length;
  const holdout = rs.length - train;
  check(
    rs.length >= 3 && rs.length <= 14,
    `${p.key}: ${rs.length} requests (want 3-14)`,
  );
  if (rs.length >= 3)
    check(train > 0 && holdout > 0, `${p.key}: missing a split`);
  return { problem: p.key, area: p.area, total: rs.length, train, holdout };
});
const oneOffs = requests.filter((r) => r.problemKey === null).length;
check(oneOffs >= 3 && oneOffs <= 10, `one-offs: ${oneOffs} (want 3-10)`);

// Split ratio ~100/50
const train = requests.filter((r) => r.split === "train").length;
check(train >= 90 && train <= 110, `train split ${train} (want ~100)`);

// Tag distribution: [min, max] share of requests
const TOLERANCE: Record<Tag, [min: number, max: number]> = {
  solution_shaped: [0.3, 0.5],
  paraphrase: [0.15, 0.35],
  false_friend: [0.05, 0.15],
  vague: [0.05, 0.15],
  verbose: [0.04, 0.12],
  injection: [0.02, 0.05],
  internal: [0.04, 0.15],
};
const countTag = (t: Tag) => requests.filter((r) => r.tags.includes(t)).length;
for (const t of TAGS) {
  const [min, max] = TOLERANCE[t];
  const share = countTag(t) / (requests.length || 1);
  check(
    share >= min && share <= max,
    `tag ${t}: ${(share * 100).toFixed(1)}% outside ${min * 100}-${max * 100}%`,
  );
}

// The holdout must exercise every common hard case, not just the train split.
for (const t of TAGS) {
  const holdout = requests.filter(
    (r) => r.split === "holdout" && r.tags.includes(t),
  ).length;
  const total = countTag(t);
  if (total >= 6)
    check(
      holdout / total >= 0.2,
      `tag ${t}: only ${holdout}/${total} in holdout`,
    );
}

check(
  strategyWords >= 250 && strategyWords <= 550,
  `strategy.md ${strategyWords} words`,
);

// Summary
const seg = (s: string) => accounts.filter((a) => a.segment === s).length;
console.log(
  `accounts: ${accounts.length} (smb ${seg("smb")}, mid_market ${seg("mid_market")}, enterprise ${seg("enterprise")}, churnRisk ${accounts.filter((a) => a.churnRisk).length})`,
);
console.log(
  `users: ${users.length} (submitters ${users.length - pms.length}, internal ${users.filter((u) => u.role === "submitter" && u.accountKey === null).length}, pms ${pms.length})`,
);
console.log(
  `requests: ${requests.length} (train ${train}, holdout ${requests.length - train}, one-offs ${oneOffs})`,
);
console.log(`tags: ${TAGS.map((t) => `${t} ${countTag(t)}`).join(", ")}`);
console.log(`strategy.md: ${strategyWords} words`);
console.table(rows);

if (errors.length) {
  console.error(`\nFAILED (${errors.length}):\n- ${errors.join("\n- ")}`);
  process.exit(1);
}
console.log("\nOK: fixtures valid");
