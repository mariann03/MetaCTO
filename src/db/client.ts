import { attachDatabasePool } from "@vercel/functions";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export function createDb(connectionString: string) {
  const pool = new Pool({ connectionString });
  // Closes idle clients before Vercel suspends the function (Fluid compute).
  attachDatabasePool(pool);
  return drizzle({ client: pool, schema });
}

/** Drizzle client bound to the app schema; `$client` is the underlying pg Pool. */
export type Db = ReturnType<typeof createDb>;

/** A transaction handle, as passed to `db.transaction` callbacks. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
