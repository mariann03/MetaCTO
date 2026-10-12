import type { Models } from "@/ai/models";
import type { Db } from "@/db/client";

/** Everything a domain operation needs, passed explicitly so tests can swap it. */
export type Deps = { db: Db; models: Models };
