import { asc, eq, sql } from "drizzle-orm";
import {
  accounts,
  type role,
  type segment,
  settings,
  users,
} from "@/db/schema";
import type { Deps } from "./deps";

export type DirectoryFixtures = {
  accounts: readonly {
    key: string;
    name: string;
    segment: (typeof segment.enumValues)[number];
    arr: number;
    churnRisk: boolean;
  }[];
  users: readonly {
    key: string;
    name: string;
    role: (typeof role.enumValues)[number];
    accountKey: string | null;
  }[];
  strategy: string;
};

const STRATEGY_KEY = "strategy";

/** Loads accounts, users and the strategy document; safe to run repeatedly. */
export async function seedDirectory(
  { db }: Pick<Deps, "db">,
  fixtures: DirectoryFixtures,
) {
  await db.transaction(async (tx) => {
    const accountIds = new Map<string, number>();
    for (const a of fixtures.accounts) {
      const [row] = await tx
        .insert(accounts)
        .values(a)
        .onConflictDoUpdate({
          target: accounts.key,
          set: {
            name: a.name,
            segment: a.segment,
            arr: a.arr,
            churnRisk: a.churnRisk,
          },
        })
        .returning({ id: accounts.id });
      if (row) accountIds.set(a.key, row.id);
    }

    for (const u of fixtures.users) {
      const accountId = u.accountKey ? accountIds.get(u.accountKey) : null;
      if (accountId === undefined)
        throw new Error(
          `User ${u.key} references unknown account ${u.accountKey}`,
        );
      const values = { key: u.key, name: u.name, role: u.role, accountId };
      await tx
        .insert(users)
        .values(values)
        .onConflictDoUpdate({ target: users.key, set: values });
    }

    await tx
      .insert(settings)
      .values({ key: STRATEGY_KEY, value: fixtures.strategy })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: fixtures.strategy },
      });
  });
}

export async function listUsers({ db }: Pick<Deps, "db">) {
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      role: users.role,
      accountName: accounts.name,
      accountSegment: accounts.segment,
    })
    .from(users)
    .leftJoin(accounts, eq(users.accountId, accounts.id))
    // Submitters first; within a role, customers before internal staff, then by name.
    .orderBy(asc(users.role), sql`${users.accountId} is null`, asc(users.name));

  return rows.map(({ accountName, accountSegment, ...user }) => ({
    ...user,
    account:
      accountName && accountSegment
        ? { name: accountName, segment: accountSegment }
        : null,
  }));
}

export type DirectoryUser = Awaited<ReturnType<typeof listUsers>>[number];

export async function getStrategy({ db }: Pick<Deps, "db">): Promise<string> {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, STRATEGY_KEY));
  return typeof row?.value === "string" ? row.value : "";
}
