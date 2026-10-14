import { asc, eq, sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { accounts, users } from "@/db/schema";
import type { DbDeps } from "./deps";
import { writeStrategy } from "./settings";

// Fixture shapes are derived from the tables, so a schema change can't drift
// silently from the seed data. Users reference accounts by fixture key.
// Strict objects: a misspelled key is an error, not a silently applied default.
export const accountFixtureSchema = createInsertSchema(accounts, {
  arr: (s) => s.positive(),
})
  .required({ churnRisk: true })
  .strict();

export const userFixtureSchema = createInsertSchema(users)
  .omit({ accountId: true })
  .extend({ accountKey: z.string().min(1).nullable() })
  .strict()
  .refine((u) => u.role !== "pm" || u.accountKey === null, {
    message: "PM users cannot belong to an account",
  });

const directoryFixturesSchema = z.strictObject({
  accounts: z.array(accountFixtureSchema),
  users: z.array(userFixtureSchema),
  strategy: z.string(),
});

/** Seed input: accounts, users (referencing accounts by fixture key) and the strategy document. */
export type DirectoryFixtures = z.infer<typeof directoryFixturesSchema>;

/** Validates raw fixture data (e.g. parsed JSON files) before seeding. */
export function parseDirectoryFixtures(raw: unknown): DirectoryFixtures {
  return directoryFixturesSchema.parse(raw);
}

/** Loads accounts, users and the strategy document; safe to run repeatedly. */
export async function seedDirectory(
  { db }: DbDeps,
  fixtures: DirectoryFixtures,
) {
  await db.transaction(async (tx) => {
    const accountIds = new Map<string, number>();
    for (const a of fixtures.accounts) {
      const [row] = await tx
        .insert(accounts)
        .values(a)
        .onConflictDoUpdate({ target: accounts.key, set: a })
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

    await writeStrategy(tx, fixtures.strategy);
  });
}

export async function listUsers({ db }: DbDeps) {
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      role: users.role,
      accountName: accounts.name,
    })
    .from(users)
    .leftJoin(accounts, eq(users.accountId, accounts.id))
    // Submitters first; within a role, customers before internal staff, then by name.
    .orderBy(asc(users.role), sql`${users.accountId} is null`, asc(users.name));

  return rows.map(({ accountName, ...user }) => ({
    ...user,
    account: accountName ? { name: accountName } : null,
  }));
}

/** A user as listed by the role switcher: id, name, role and their account (null for staff and PMs). */
export type DirectoryUser = Awaited<ReturnType<typeof listUsers>>[number];

/**
 * Whether the user is on our team: a PM, or staff with no account (Sales, CS, Support).
 * Our team may see what customers must not, such as requests naming accounts and ARR.
 */
export async function isOurTeam({ db }: DbDeps, userId: number) {
  const [user] = await db
    .select({ role: users.role, accountId: users.accountId })
    .from(users)
    .where(eq(users.id, userId));
  return user !== undefined && (user.role === "pm" || user.accountId === null);
}

/** Throws unless the user is a PM; PM-only operations call it first. */
export async function requirePm({ db }: DbDeps, userId: number, what: string) {
  const [user] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId));
  if (user?.role !== "pm") throw new Error(`Only a PM can ${what}`);
}
