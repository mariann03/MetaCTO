import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";
import { createDb, type Db } from "@/db/client";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://postgres:postgres@localhost:5432/app_test";

// Creates the database if missing and applies all migrations.
export async function prepareDatabase(url: string) {
  const target = new URL(url);
  const name = target.pathname.slice(1);
  target.pathname = "/postgres";
  const admin = new Client({ connectionString: target.toString() });
  await admin.connect();
  try {
    const { rowCount } = await admin.query(
      "select 1 from pg_database where datname = $1",
      [name],
    );
    if (!rowCount) await admin.query(`create database "${name}"`);
  } finally {
    await admin.end();
  }

  const db = createDb(url);
  await migrate(db, { migrationsFolder: "drizzle" });
  return db;
}

export async function resetDatabase(db: Db) {
  const { rows } = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public'`,
  );
  const tables = rows.map((r) => `"${r.tablename}"`).join(", ");
  await db.execute(sql.raw(`truncate ${tables} restart identity cascade`));
}
