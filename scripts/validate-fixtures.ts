// Validates data/fixtures. Run: bun scripts/validate-fixtures.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(import.meta.dir, "..", "data", "fixtures");
const errors: string[] = [];
const check = (ok: boolean, msg: string) => {
  if (!ok) errors.push(msg);
};

type Account = {
  key: string;
  name: string;
  segment: string;
  arr: number;
  churnRisk: boolean;
};
type User = {
  key: string;
  name: string;
  role: string;
  accountKey: string | null;
};
type Problem = { key: string; statement: string; area: string; notes: string };
type Request = {
  key: string;
  problemKey: string | null;
  authorKey: string;
  title: string;
  description: string;
  split: string;
  tags: string[];
};

function load<T>(file: string): T[] {
  try {
    const data = JSON.parse(readFileSync(join(DIR, file), "utf8"));
    if (!Array.isArray(data)) throw new Error("not an array");
    return data;
  } catch (e) {
    errors.push(`${file}: ${(e as Error).message}`);
    return [];
  }
}

const accounts = load<Account>("accounts.json");
const users = load<User>("users.json");
const problems = load<Problem>("problems.json");
const requests = load<Request>("requests.json");

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

// Field shapes
const SEGMENTS = ["smb", "mid_market", "enterprise"];
for (const a of accounts) {
  check(SEGMENTS.includes(a.segment), `${a.key}: bad segment ${a.segment}`);
  check(Number.isInteger(a.arr) && a.arr > 0, `${a.key}: bad arr`);
  check(typeof a.churnRisk === "boolean", `${a.key}: churnRisk not boolean`);
}
for (const p of problems) {
  check(!!p.statement && !!p.area && !!p.notes, `${p.key}: missing fields`);
}

// References
const accountByKey = new Map(accounts.map((a) => [a.key, a]));
const userByKey = new Map(users.map((u) => [u.key, u]));
const problemKeys = new Set(problems.map((p) => p.key));
for (const u of users) {
  check(["submitter", "pm"].includes(u.role), `${u.key}: bad role`);
  if (u.accountKey !== null)
    check(
      accountByKey.has(u.accountKey),
      `${u.key}: unknown account ${u.accountKey}`,
    );
  if (u.role === "pm") check(u.accountKey === null, `${u.key}: PM has account`);
}
for (const a of accounts) {
  const n = users.filter((u) => u.accountKey === a.key).length;
  check(n >= 1 && n <= 3, `${a.key}: ${n} submitters (want 1-3)`);
}

const TAGS = [
  "solution_shaped",
  "paraphrase",
  "false_friend",
  "vague",
  "verbose",
  "injection",
  "internal",
];
for (const r of requests) {
  const author = userByKey.get(r.authorKey);
  check(author?.role === "submitter", `${r.key}: author not a submitter`);
  check(
    r.problemKey === null || problemKeys.has(r.problemKey),
    `${r.key}: unknown problem ${r.problemKey}`,
  );
  check(["train", "holdout"].includes(r.split), `${r.key}: bad split`);
  check(!!r.title && !!r.description, `${r.key}: empty title/description`);
  for (const t of r.tags) check(TAGS.includes(t), `${r.key}: bad tag ${t}`);
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
const TOLERANCE: Record<string, [number, number]> = {
  solution_shaped: [0.3, 0.5],
  paraphrase: [0.15, 0.35],
  false_friend: [0.05, 0.15],
  vague: [0.05, 0.15],
  verbose: [0.04, 0.12],
  injection: [0.02, 0.05],
  internal: [0.04, 0.15],
};
const tagCounts = Object.fromEntries(
  TAGS.map((t) => [t, requests.filter((r) => r.tags.includes(t)).length]),
);
for (const [t, [min, max]] of Object.entries(TOLERANCE)) {
  const share = tagCounts[t] / (requests.length || 1);
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
  if (tagCounts[t] >= 6)
    check(
      holdout / tagCounts[t] >= 0.2,
      `tag ${t}: only ${holdout}/${tagCounts[t]} in holdout`,
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
console.log(`tags: ${TAGS.map((t) => `${t} ${tagCounts[t]}`).join(", ")}`);
console.log(`strategy.md: ${strategyWords} words`);
console.table(rows);

if (errors.length) {
  console.error(`\nFAILED (${errors.length}):\n- ${errors.join("\n- ")}`);
  process.exit(1);
}
console.log("\nOK: fixtures valid");
