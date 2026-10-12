import { embedMany } from "ai";
import { eq, inArray, isNotNull } from "drizzle-orm";
import { requests, users } from "@/db/schema";
import type { Deps } from "./deps";
import { embeddingText, modelName, submitRequest } from "./intake";

/** A fixture request: who sends it and what it says. */
export interface SeedRequest {
  key: string;
  authorKey: string;
  title: string;
  description: string;
}

/**
 * Sends each fixture request through the real intake pipeline as its author, in order,
 * so the demo data is grouped exactly as live submissions would be.
 */
export async function seedRequests(
  deps: Deps,
  fixtures: SeedRequest[],
  onProgress: (done: number, total: number) => void = () => {},
) {
  const authorKeys = [...new Set(fixtures.map((f) => f.authorKey))];
  const rows = await deps.db
    .select({ id: users.id, key: users.key })
    .from(users)
    .where(inArray(users.key, authorKeys));
  const authors = new Map(rows.map((u) => [u.key, u.id]));

  const summary = { submitted: 0, draft: 0, high: 0, medium: 0, low: 0 };
  for (const [index, fixture] of fixtures.entries()) {
    const authorId = authors.get(fixture.authorKey);
    if (authorId === undefined)
      throw new Error(
        `Request ${fixture.key} has unknown author ${fixture.authorKey}`,
      );
    const result = await submitRequest(deps, {
      authorId,
      title: fixture.title,
      description: fixture.description,
    });
    if (result.status === "submitted") {
      summary.submitted += 1;
      summary[result.tier] += 1;
    } else if (result.status === "draft") summary.draft += 1;
    else throw new Error(`Request ${fixture.key} was ${result.status}`);
    onProgress(index + 1, fixtures.length);
  }
  return summary;
}

/** Re-embeds every request with the configured embedding model; returns how many. */
export async function reembedRequests({ db, models }: Deps) {
  const rows = await db
    .select({
      id: requests.id,
      title: requests.title,
      description: requests.description,
    })
    .from(requests)
    .where(isNotNull(requests.embedding));
  if (rows.length === 0) return 0;

  const { embeddings } = await embedMany({
    model: models.embedding,
    values: rows.map(embeddingText),
  });
  const embeddingModel = modelName(models.embedding);
  await db.transaction(async (tx) => {
    for (const [i, row] of rows.entries())
      await tx
        .update(requests)
        .set({ embedding: embeddings[i], embeddingModel })
        .where(eq(requests.id, row.id));
  });
  return rows.length;
}
