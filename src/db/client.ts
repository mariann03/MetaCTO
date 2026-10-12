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

export type Db = ReturnType<typeof createDb>;
