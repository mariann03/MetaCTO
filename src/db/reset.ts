import { sql } from "drizzle-orm";
import type { Db } from "./client";

/** Empties every table (keeping the schema), e.g. before re-seeding demo data. */
export async function resetDatabase(db: Db) {
  const { rows } = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public'`,
  );
  const tables = rows.map((r) => `"${r.tablename}"`).join(", ");
  await db.execute(sql.raw(`truncate ${tables} restart identity cascade`));
}
