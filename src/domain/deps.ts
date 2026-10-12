import type { Models } from "@/ai/models";
import type { Db } from "@/db/client";

/** Everything a domain operation needs, passed explicitly so tests can swap it. */
export interface Deps {
  db: Db;
  models: Models;
}

/** Dependencies of operations that only touch the database. */
export type DbDeps = Pick<Deps, "db">;
