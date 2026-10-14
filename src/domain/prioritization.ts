import { asc, count, eq, notInArray, type SQL, sql } from "drizzle-orm";
import { accounts, problems, supports, users } from "@/db/schema";
import type { DbDeps } from "./deps";
import { DECIDED } from "./problems";
import { listScores, unscored } from "./scoring";

const total = (value: SQL.Aliased) =>
  sql<number>`coalesce(${value}, 0)`.mapWith(Number);

/**
 * The criteria of every Problem still to decide. The data-driven ones are computed in SQL on
 * each read so they are always current: Reach (distinct supporters and accounts) and Business
 * value (ARR, segment mix, churn risk). ARR counts each account once, however many of its
 * people support the Problem. The AI-judged ones come with their staleness and overrides.
 */
export async function listCriteria({ db }: DbDeps) {
  // One row per Problem and supporting account.
  const backers = db
    .selectDistinct({
      problemId: supports.problemId,
      accountId: accounts.id,
      arr: accounts.arr,
      segment: accounts.segment,
      churnRisk: accounts.churnRisk,
    })
    .from(supports)
    .innerJoin(users, eq(users.id, supports.userId))
    .innerJoin(accounts, eq(accounts.id, users.accountId))
    .as("backers");
  const byAccount = db
    .select({
      problemId: backers.problemId,
      accounts: count().as("accounts"),
      arr: sql`sum(${backers.arr})`.as("arr"),
      churnRiskArr:
        sql`sum(${backers.arr}) filter (where ${backers.churnRisk})`.as(
          "churn_risk_arr",
        ),
      smb: sql`count(*) filter (where ${backers.segment} = 'smb')`.as("smb"),
      midMarket:
        sql`count(*) filter (where ${backers.segment} = 'mid_market')`.as(
          "mid_market",
        ),
      enterprise:
        sql`count(*) filter (where ${backers.segment} = 'enterprise')`.as(
          "enterprise",
        ),
    })
    .from(backers)
    .groupBy(backers.problemId)
    .as("by_account");
  const bySupporter = db
    .select({
      problemId: supports.problemId,
      supporters: count().as("supporters"),
    })
    .from(supports)
    .groupBy(supports.problemId)
    .as("by_supporter");

  const rows = await db
    .select({
      id: problems.id,
      statement: problems.statement,
      supporters: total(bySupporter.supporters),
      accounts: total(byAccount.accounts),
      arr: total(byAccount.arr),
      churnRiskArr: total(byAccount.churnRiskArr),
      smb: total(byAccount.smb),
      midMarket: total(byAccount.midMarket),
      enterprise: total(byAccount.enterprise),
    })
    .from(problems)
    .leftJoin(bySupporter, eq(bySupporter.problemId, problems.id))
    .leftJoin(byAccount, eq(byAccount.problemId, problems.id))
    .where(notInArray(problems.status, DECIDED))
    .orderBy(asc(problems.id));

  const judged = await listScores(db);
  return rows.map(({ smb, midMarket, enterprise, ...criteria }) => ({
    ...criteria,
    segments: { smb, mid_market: midMarket, enterprise },
    judged: judged.get(criteria.id) ?? unscored(),
  }));
}

export type ProblemCriteria = Awaited<ReturnType<typeof listCriteria>>[number];
