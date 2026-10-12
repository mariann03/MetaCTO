import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { problems } from "@/db/schema";
import {
  prepareDatabase,
  resetDatabase,
  TEST_DATABASE_URL,
} from "../../test/db";
import { listUsers, seedDirectory } from "./directory";
import { insertProblem } from "./intake";
import { listCriteria } from "./prioritization";
import { addSupport } from "./problems";
import { rank } from "./ranking";

let db: Db;

beforeAll(async () => {
  db = await prepareDatabase(TEST_DATABASE_URL);
});
afterAll(async () => {
  await db.$client.end();
});

/**
 * Three accounts and four Problems:
 * - Exports: two people at the bakery and a PM with no account
 * - SSO: one person at an enterprise at risk of churning
 * - Payroll: the bakery and a mid-market account
 * - Audit log: nobody supports it any more
 */
async function seedKnownDataset() {
  await resetDatabase(db);
  await seedDirectory(
    { db },
    {
      accounts: [
        {
          key: "bakery",
          name: "Brightside Bakery",
          segment: "smb",
          arr: 4800,
          churnRisk: false,
        },
        {
          key: "bank",
          name: "Northwind Bank",
          segment: "enterprise",
          arr: 120000,
          churnRisk: true,
        },
        {
          key: "clinic",
          name: "Lakeside Clinic",
          segment: "mid_market",
          arr: 30000,
          churnRisk: false,
        },
      ],
      users: [
        { key: "u-1", name: "Alice", role: "submitter", accountKey: "bakery" },
        { key: "u-2", name: "Bob", role: "submitter", accountKey: "bakery" },
        { key: "u-3", name: "Carol", role: "submitter", accountKey: "bank" },
        { key: "u-4", name: "Dan", role: "submitter", accountKey: "clinic" },
        { key: "u-5", name: "Priya", role: "pm", accountKey: null },
      ],
      strategy: "",
    },
  );
  const users = await listUsers({ db });
  const user = (name: string) => users.find((u) => u.name === name)?.id ?? 0;
  const problem = async (statement: string, supporters: string[]) => {
    const problemId = await db.transaction((tx) =>
      insertProblem(tx, statement),
    );
    for (const name of supporters)
      await addSupport(
        { db },
        { userId: user(name), problemId, note: null, source: "explore" },
      );
    return problemId;
  };
  return {
    exports: await problem("Exports", ["Alice", "Bob", "Priya"]),
    sso: await problem("SSO", ["Carol"]),
    payroll: await problem("Payroll", ["Alice", "Dan"]),
    audit: await problem("Audit log", []),
  };
}

let ids: Awaited<ReturnType<typeof seedKnownDataset>>;
beforeEach(async () => {
  ids = await seedKnownDataset();
});

describe("listCriteria", () => {
  test("counts distinct supporters and accounts, and sums ARR once per account", async () => {
    const criteria = await listCriteria({ db });
    const byId = new Map(criteria.map((c) => [c.id, c]));

    expect(byId.get(ids.exports)).toEqual({
      id: ids.exports,
      statement: "Exports",
      supporters: 3,
      accounts: 1,
      arr: 4800,
      churnRiskArr: 0,
      segments: { smb: 1, mid_market: 0, enterprise: 0 },
    });
    expect(byId.get(ids.sso)).toMatchObject({
      supporters: 1,
      accounts: 1,
      arr: 120000,
      churnRiskArr: 120000,
      segments: { smb: 0, mid_market: 0, enterprise: 1 },
    });
    expect(byId.get(ids.payroll)).toMatchObject({
      supporters: 2,
      accounts: 2,
      arr: 34800,
      churnRiskArr: 0,
      segments: { smb: 1, mid_market: 1, enterprise: 0 },
    });
    expect(byId.get(ids.audit)).toMatchObject({
      supporters: 0,
      accounts: 0,
      arr: 0,
      churnRiskArr: 0,
      segments: { smb: 0, mid_market: 0, enterprise: 0 },
    });
  });

  test("leaves out Problems already decided: shipped or declined", async () => {
    await db
      .update(problems)
      .set({ status: "shipped" })
      .where(inArray(problems.id, [ids.sso]));
    await db
      .update(problems)
      .set({ status: "declined" })
      .where(inArray(problems.id, [ids.audit]));
    await db
      .update(problems)
      .set({ status: "planned" })
      .where(inArray(problems.id, [ids.payroll]));

    expect((await listCriteria({ db })).map((c) => c.statement)).toEqual([
      "Exports",
      "Payroll",
    ]);
  });

  test("is always current: a new supporter shows up on the next read", async () => {
    const [carol] = (await listUsers({ db })).filter((u) => u.name === "Carol");
    await addSupport(
      { db },
      {
        userId: carol?.id ?? 0,
        problemId: ids.payroll,
        note: null,
        source: "explore",
      },
    );

    const payroll = (await listCriteria({ db })).find(
      (c) => c.id === ids.payroll,
    );
    expect(payroll).toMatchObject({
      supporters: 3,
      accounts: 3,
      arr: 154800,
      churnRiskArr: 120000,
    });
  });
});

describe("rank", () => {
  const order = (ranked: { statement: string }[]) =>
    ranked.map((r) => r.statement);

  test("scores each criterion relative to the top Problem", async () => {
    const ranked = rank(await listCriteria({ db }), {
      reach: 1,
      businessValue: 1,
    });
    const scores = Object.fromEntries(
      ranked.map((r) => [r.statement, r.scores]),
    );

    // Reach: half supporters (max 3), half accounts (max 2).
    expect(scores.Exports?.reach).toBeCloseTo((3 / 3 + 1 / 2) / 2);
    expect(scores.Payroll?.reach).toBeCloseTo((2 / 3 + 2 / 2) / 2);
    // Business value: ARR with at-risk ARR counted twice (max 240,000 for SSO).
    expect(scores.SSO?.businessValue).toBeCloseTo(1);
    expect(scores.Payroll?.businessValue).toBeCloseTo(34800 / 240000);
    expect(scores["Audit log"]).toEqual({ reach: 0, businessValue: 0 });
  });

  test("orders by the weighted score, which follows the weights", async () => {
    const criteria = await listCriteria({ db });

    expect(order(rank(criteria, { reach: 1, businessValue: 0 }))).toEqual([
      "Payroll",
      "Exports",
      "SSO",
      "Audit log",
    ]);
    expect(order(rank(criteria, { reach: 0, businessValue: 1 }))).toEqual([
      "SSO",
      "Payroll",
      "Exports",
      "Audit log",
    ]);
    // Reach 3 to 1: Payroll .661, Exports .568, SSO .563.
    const mixed = rank(criteria, { reach: 3, businessValue: 1 });
    expect(order(mixed)).toEqual(["Payroll", "Exports", "SSO", "Audit log"]);
    expect(mixed[0]?.score).toBeCloseTo((3 * 0.8333 + 34800 / 240000) / 4, 3);
  });

  test("with every weight at zero, all score zero and keep the oldest first", async () => {
    const ranked = rank(await listCriteria({ db }), {
      reach: 0,
      businessValue: 0,
    });

    expect(ranked.map((r) => r.score)).toEqual([0, 0, 0, 0]);
    expect(order(ranked)).toEqual(["Exports", "SSO", "Payroll", "Audit log"]);
  });
});
