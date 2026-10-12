import { asc, eq, sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { accounts, settings, users } from "@/db/schema";
import type { Deps } from "./deps";

// Fixture shapes are derived from the tables, so a schema change can't drift
// silently from the seed data. Users reference accounts by fixture key.
const directoryFixturesSchema = z.object({
  accounts: z.array(createInsertSchema(accounts)),
  users: z.array(
    createInsertSchema(users)
      .omit({ accountId: true })
      .extend({ accountKey: z.string().nullable() }),
  ),
  strategy: z.string(),
});

export type DirectoryFixtures = z.infer<typeof directoryFixturesSchema>;

/** Validates raw fixture data (e.g. parsed JSON files) before seeding. */
export function parseDirectoryFixtures(raw: unknown): DirectoryFixtures {
  return directoryFixturesSchema.parse(raw);
}

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
