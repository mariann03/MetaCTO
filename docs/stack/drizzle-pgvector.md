# Drizzle ORM + Postgres + pgvector (Next.js / bun / Vercel + Neon / Docker)

Researched 2026-10-12. Sources: Context7 (`/drizzle-team/drizzle-orm-docs`, `/neondatabase/website`, `/neondatabase/serverless`), the official docs linked below, and the npm registry / Docker Hub.

**Verified** means the snippet was run end to end in a scratch bun project against `pgvector/pgvector:pg17` (and `:pg18` for the volume check) on 2026-10-12. Anything not checked is marked **UNVERIFIED**.

## Versions (npm `latest` / Docker Hub, 2026-10-12)

| Package | Stable | Notes |
|---|---|---|
| `drizzle-orm` | **0.45.4** | v1 is still prerelease (`rc` tag = 1.0.0-rc.4, `beta` = 1.0.0-beta.22). Don't use it. |
| `drizzle-kit` | **0.31.11** | Same v1 RC caveat. |
| `pg` | 8.23.1 | plus `@types/pg` 8.23.1 (dev) |
| `@vercel/functions` | 3.9.11 | provides `attachDatabasePool` |
| `postgres` (postgres-js) | 3.4.9 | not recommended here |
| `@neondatabase/serverless` | 1.2.0 | needs node >= 19; not recommended here |
| `pgvector/pgvector` image | `pg17` / `pg18` (pgvector **0.8.7**) | also `0.8.7-pg18`, `-trixie`, and `-bookworm` variants |
| Neon pgvector | **0.8.0** on PG14-17, **0.8.6** on PG18 | from neon.com/docs/extensions/pg-extensions |

**Gotcha: the docs have moved ahead of the stable release.** orm.drizzle.team and Context7 already show v1 material: a banner promoting the beta, and a `drizzle/<timestamp>_<name>/migration.sql` folder-per-migration layout. Stable drizzle-kit 0.31.11 still writes flat files: `drizzle/0000_name.sql` + `drizzle/meta/_journal.json` + `meta/0000_snapshot.json` (verified).

---

## 1. Drizzle ORM + drizzle-kit: install, config, migrations

```bash
bun add drizzle-orm pg @vercel/functions
bun add -d drizzle-kit @types/pg
```

`drizzle.config.ts` (verified):

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  // Migrations should use Neon's DIRECT (non -pooler) URL; locally both are the same.
  dbCredentials: { url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL! },
});
```

`package.json` scripts (verified):

```json
"db:generate": "drizzle-kit generate",
"db:migrate": "drizzle-kit migrate",
"db:migrate:bun": "bun run src/db/migrate.ts"
```

- **Env loading:** `bun run db:migrate` and `bunx drizzle-kit migrate` both picked up `DATABASE_URL` from `.env` with no `dotenv` import, because bun auto-loads `.env` (verified). It's UNVERIFIED whether this also covers `.env.local`, the Next.js convention. If it doesn't, put the DB URL in `.env` or `import "dotenv/config"`.

### generate + migrate vs push

- **`generate` + `migrate`** (codebase-first, versioned SQL): use this for anything deployed. `generate` diffs the schema against the last snapshot and writes SQL. `migrate` applies pending files and records them in `drizzle.__drizzle_migrations`. Re-running is a no-op (verified).
- **`push`**: applies the schema diff directly with no SQL files. Only use it for throwaway local prototyping. It does not run your custom `CREATE EXTENSION` migration, so on a fresh DB you would have to create the extension by hand (UNVERIFIED that push never emits it, but the docs only show the extension being enabled through a custom migration).

### Enabling `vector` (custom migration), verified order

The extension migration must come **before** the first migration that uses `vector(...)`. Generate it first:

```bash
bunx drizzle-kit generate --custom --name enable_pgvector   # -> drizzle/0000_enable_pgvector.sql (empty)
echo 'CREATE EXTENSION IF NOT EXISTS vector;' > drizzle/0000_enable_pgvector.sql
bunx drizzle-kit generate --name init                       # -> drizzle/0001_init.sql (tables + indexes)
bun run db:migrate
```

The docs show bare `CREATE EXTENSION vector;`. Use `IF NOT EXISTS`, because Neon or someone else may already have enabled it.

### Running migrations from a bun script (verified)

`src/db/migrate.ts`:

```ts
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL, max: 1 });
await migrate(drizzle({ client: pool }), { migrationsFolder: "./drizzle" });
await pool.end();
console.log("migrations applied");
```

The `migrate` options also accept `migrationsTable` and `migrationsSchema` (from the docs; not exercised).

---

## 2. Driver choice: **node-postgres (`pg`) + `drizzle-orm/node-postgres` + `attachDatabasePool`**

| Driver | Local Docker PG | Neon from Vercel | Interactive `db.transaction` |
|---|---|---|---|
| `pg` via `drizzle-orm/node-postgres` | yes, plain TCP | yes, TCP to the `-pooler` host; **Neon's current recommendation for Vercel Fluid compute** | **yes** (verified) |
| `postgres` via `drizzle-orm/postgres-js` | yes | yes over TCP | yes, but needs extra care behind PgBouncer (prepared statements; see gotchas) |
| `@neondatabase/serverless` `neon()` via `drizzle-orm/neon-http` | **no**: talks HTTP to Neon's proxy, not plain Postgres | yes | **NO**. The drizzle source throws `"No transactions support in neon-http driver"` (verified in `node_modules/drizzle-orm/neon-http/session.js`). Only non-interactive `db.batch()` is supported. |
| `@neondatabase/serverless` `Pool` via `drizzle-orm/neon-serverless` (WebSocket) | **no** without running a local wsproxy | yes | yes, but the Pool must be created, used and closed within one request handler in serverless |

Neon's own docs ("Connecting to Neon from Vercel") say that with Vercel **Fluid compute** you should use a standard TCP driver (node-postgres) with a pool plus `attachDatabasePool`. The HTTP serverless driver was the workaround for classic serverless, which couldn't pool connections. Vercel's `@vercel/functions` docs list `pg` as a supported pool type. `pg` also talks to the local Docker Postgres unchanged, so one client module works in both places.

`src/db/client.ts` (verified locally under bun; `attachDatabasePool` did not get in the way off-Vercel):

```ts
import { attachDatabasePool } from "@vercel/functions";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
attachDatabasePool(pool); // closes idle clients before Vercel suspends the function

export const db = drizzle({ client: pool, schema });
```

Gotchas:
- This assumes Fluid compute is enabled on the Vercel project. UNVERIFIED: whether it's the default for new projects; check the project settings.
- Use the Node.js runtime, not Edge. `pg` needs TCP.
- UNVERIFIED: whether Next.js 15/16 still needs `serverExternalPackages: ["pg"]`. `pg` has historically been on Next's built-in external list.
- postgres-js behind Neon's PgBouncer: Drizzle's docs for transaction-mode poolers use `postgres(url, { prepare: false })`. Neon's PgBouncer does support protocol-level prepared statements (`max_prepared_statements=1000`), but `prepare: false` is still the safe default. UNVERIFIED on Neon specifically; this setup avoids the question by using `pg`.

---

## 3. pgvector with Drizzle

### Schema (verified; produced the SQL shown)

```ts
import { index, pgTable, serial, text, vector } from "drizzle-orm/pg-core";

export const chunks = pgTable(
  "chunks",
  {
    id: serial("id").primaryKey(),
    docId: text("doc_id").notNull(),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }).notNull(),
  },
  (t) => [
    index("chunks_embedding_hnsw").using("hnsw", t.embedding.op("vector_cosine_ops")),
    index("chunks_doc_id_idx").on(t.docId),
  ],
);
```

Generated SQL:

```sql
CREATE TABLE "chunks" (... "embedding" vector(1536) NOT NULL);
CREATE INDEX "chunks_embedding_hnsw" ON "chunks" USING hnsw ("embedding" vector_cosine_ops);
CREATE INDEX "chunks_doc_id_idx" ON "chunks" USING btree ("doc_id");
```

Note: the extra table callback must return an **array** (`(t) => [...]`). That is the current API.

### Top-k similarity query: use the index-friendly form (verified with EXPLAIN)

**Big gotcha: the official Drizzle guide's pattern does not use the HNSW index.** The guide does `orderBy((t) => desc(t.similarity))` where `similarity = 1 - cosineDistance(...)`. That orders by `1 - (embedding <=> q) DESC`, and Postgres can't serve that ordering from the index. Its plan was **Seq Scan + Sort** (verified). Ordering by **`asc(cosineDistance(...))`** gives `Index Scan using chunks_embedding_hnsw ... Order By: (embedding <=> ...)` (verified). Compute the similarity only in the select list.

```ts
import { and, asc, cosineDistance, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { chunks } from "@/db/schema";

export async function topK(queryEmbedding: number[], docIds: string[], k = 5, minSimilarity = 0.3) {
  const distance = cosineDistance(chunks.embedding, queryEmbedding);
  return db.transaction(async (tx) => {
    // Filtered HNSW: without this, ef_search=40 can return fewer than k rows after filtering.
    await tx.execute(sql`SET LOCAL hnsw.iterative_scan = relaxed_order`);
    return tx
      .select({ id: chunks.id, docId: chunks.docId, content: chunks.content, similarity: sql<number>`1 - (${distance})` })
      .from(chunks)
      .where(and(inArray(chunks.docId, docIds), lt(distance, 1 - minSimilarity)))
      .orderBy(asc(distance))
      .limit(k);
  });
}
```

Verified plan: `Index Scan using chunks_embedding_hnsw`, `Order By: (embedding <=> '[...]')`, `Filter: (doc_id = ... AND (embedding <=> ...) < 0.7)`.

Gotchas:
- **The planner chooses.** With a selective filter (about 100 rows per doc_id out of 5k) the planner used the btree on `doc_id` + Sort, which is an exact search and fine. With a less selective filter it used HNSW (verified both). Either way, keep the `ORDER BY distance ASC` form.
- **Filtering happens after the HNSW scan.** By default `hnsw.ef_search` = 40, so a filter that matches 10% of rows returns about 4 rows. Fix it with `hnsw.iterative_scan` (pgvector >= 0.8.0, so it's available on Neon too), or use partial indexes for a few fixed filter values. Source: pgvector README.
- Use **`SET LOCAL`** inside a transaction, not `SET`. Neon's pooled endpoint is PgBouncer in transaction mode, and session `SET` is listed as not supported there.
- NULL vectors aren't indexed, and for cosine neither are zero vectors.
- An index built on an empty table works, but bulk-loading first and creating the index afterwards is faster. Builds are fast while the graph fits in `maintenance_work_mem`.
- `cosineDistance(column, number[])` binds the array as a parameter (`$1`). That was verified to work with pg; no manual `'[..]'::vector` cast is needed.

---

## 4. Advisory locks inside `db.transaction` (verified)

```ts
import { sql } from "drizzle-orm";

await db.transaction(async (tx) => {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`doc:${docId}`}))`);
  // ... critical section; lock auto-releases on COMMIT/ROLLBACK
});
```

Verified: two concurrent transactions on the same key serialized (tx2 got the lock about 510 ms after tx1, which held it for 500 ms), and `pg_locks` showed 0 advisory locks after commit.

Gotchas:
- **Use the `_xact_` variant.** Session-level advisory locks (`pg_advisory_lock`) are explicitly **not supported** on Neon's pooled (PgBouncer transaction-mode) connections. Transaction-scoped locks are fine because the server connection stays pinned for the whole transaction.
- `hashtext()` returns int4 and is implicitly cast to the bigint overload. It's an undocumented internal hash function, so collisions are possible but harmless for locks. For a stable 64-bit key, hash the key in the app and pass a bigint.
- The lock requires an interactive transaction, so `neon-http` is ruled out.

---

## 5. Local Postgres + pgvector via Docker Compose (verified)

```yaml
services:
  db:
    image: pgvector/pgvector:pg17
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: app
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data   # PG <= 17 path
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d app"]
      interval: 2s
      timeout: 3s
      retries: 20
volumes:
  pgdata:
```

`docker compose up -d --wait` blocks until the container is healthy (verified). Local URL: `postgres://postgres:postgres@localhost:5432/app`.

**PG18 gotcha (verified):** starting with the Postgres 18 images, `PGDATA` is `/var/lib/postgresql/18/docker` and the declared volume moved to **`/var/lib/postgresql`**. With `pgvector/pgvector:pg18`, mount `pgdata:/var/lib/postgresql`. Mounting at `/var/lib/postgresql/data` does not persist where you expect. For PG <= 17, keep `/var/lib/postgresql/data`; the official image docs warn against mounting the parent path there.

**Which major to pick:** match your Neon project's Postgres major. Neon ships pgvector 0.8.0 on PG17 and 0.8.6 on PG18, while the local images ship 0.8.7. If the Neon project is PG18, use `pgvector/pgvector:pg18` (versions closest to Neon) with the new volume path. UNVERIFIED: Neon's default major for new projects. Check it in the console.

---

## 6. Neon notes

- **pgvector is available.** Run `CREATE EXTENSION vector;` (the custom migration above handles it). Versions: 0.8.0 (PG14-17), 0.8.6 (PG18). Neon also lets you install one version back.
- **Connection strings:**
  - Pooled (app runtime): host has `-pooler` after the endpoint ID, e.g. `ep-xxx-pooler.us-east-2.aws.neon.tech`. PgBouncer in **transaction mode** accepts up to 10,000 client connections.
  - Direct (migrations, `pg_dump`, admin): the same host without `-pooler`. Neon's table explicitly says to use **Direct for schema migrations**.
  - Both include `?sslmode=require&channel_binding=require`.
- Env convention used above: `DATABASE_URL` = pooled (runtime), `DATABASE_URL_UNPOOLED` = direct (drizzle-kit / migrate script). UNVERIFIED: that the Neon-Vercel integration auto-populates exactly `DATABASE_URL_UNPOOLED`. If it doesn't, set it by hand.
- Not supported on the pooled endpoint: session `SET`/`RESET`, `LISTEN/NOTIFY`, SQL-level `PREPARE`, session advisory locks, `WITH HOLD` cursors. So use `SET LOCAL` and `pg_advisory_xact_lock`.
- Run migrations from CI or a build step against the direct URL, not from inside a serverless request.
- After Neon ships a new extension version, a compute restart is needed before you can install it.

---

## Sources

- Drizzle vector guide: https://orm.drizzle.team/docs/guides/vector-similarity-search
- Drizzle pg extensions (vector, HNSW ops): https://orm.drizzle.team/docs/extensions/pg
- Drizzle migrations: https://orm.drizzle.team/docs/migrations
- Drizzle config file: https://orm.drizzle.team/docs/drizzle-config-file
- Drizzle + Neon (http / websocket / node-postgres / postgres-js): https://orm.drizzle.team/docs/connect-neon
- Neon, Connecting from Vercel (Fluid compute, attachDatabasePool): https://neon.com/docs/guides/vercel-connection-methods
- Neon connection pooling (PgBouncer config, unsupported features, pooled vs direct): https://neon.com/docs/connect/connection-pooling
- Neon pgvector: https://neon.com/docs/extensions/pgvector
- Neon extension versions table: https://neon.com/docs/extensions/pg-extensions
- Neon serverless driver README (http has no transactions; Pool/Client over WS): https://github.com/neondatabase/serverless
- Vercel `@vercel/functions` (`attachDatabasePool`): https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package
- pgvector README (HNSW, filtering, iterative scans): https://github.com/pgvector/pgvector
- pgvector Docker tags: https://hub.docker.com/r/pgvector/pgvector/tags
- Postgres official image (PG18 PGDATA/volume change): https://hub.docker.com/_/postgres
