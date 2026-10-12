import { embed } from "ai";
import { asc, count, desc, eq, inArray, type SQL, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { events, problems, supports } from "@/db/schema";
import type { DbDeps, Deps } from "./deps";
import { embeddingText, findCandidates } from "./intake";

/** Problems with how many people support them, and whether the viewer is one of them. */
function problemSummaries(db: Db, viewerId: number, where?: SQL) {
  return db
    .select({
      id: problems.id,
      statement: problems.statement,
      supporters: count(supports.id),
      supported: sql<boolean>`coalesce(bool_or(${supports.userId} = ${viewerId}), false)`,
    })
    .from(problems)
    .leftJoin(supports, eq(supports.problemId, problems.id))
    .where(where)
    .groupBy(problems.id);
}

/** Every Problem, most supported first. */
export async function listProblems({ db }: DbDeps, viewerId: number) {
  return problemSummaries(db, viewerId).orderBy(
    desc(count(supports.id)),
    asc(problems.id),
  );
}

export type ProblemSummary = Awaited<ReturnType<typeof listProblems>>[number];

/**
 * Problems that look like what the user is writing, closest first: the request text is
 * embedded and matched against submitted requests, each Problem at its best match.
 * Embedding only, no LLM call, so it can run while the user types.
 */
export async function findMatches(
  { db, models }: Deps,
  {
    viewerId,
    title,
    description,
  }: { viewerId: number; title: string; description: string },
) {
  const { embedding } = await embed({
    model: models.embedding,
    value: embeddingText({ title, description }),
  });
  const candidates = await db.transaction((tx) =>
    findCandidates(tx, embedding),
  );
  if (candidates.length === 0) return [];
  const summaries = await problemSummaries(
    db,
    viewerId,
    inArray(
      problems.id,
      candidates.map((c) => c.problemId),
    ),
  );
  return candidates.flatMap(({ problemId, similarity }) => {
    const summary = summaries.find((s) => s.id === problemId);
    return summary ? [{ ...summary, similarity }] : [];
  });
}

/** Where a +1 came from: the submit page (instead of filing a request), or Explore. */
export const SUPPORT_SOURCES = ["submit", "explore"] as const;
export type SupportSource = (typeof SUPPORT_SOURCES)[number];

/**
 * "+1, this affects me": the user supports the Problem, with an optional note kept as
 * evidence. One support per user per Problem, so a second +1 changes nothing. From the
 * submit page it is a deflection: a duplicate request that was never filed.
 */
export async function addSupport(
  { db }: DbDeps,
  {
    userId,
    problemId,
    note,
    source,
  }: {
    userId: number;
    problemId: number;
    note: string | null;
    source: SupportSource;
  },
): Promise<"added" | "already_supported" | "missing"> {
  return db.transaction(async (tx) => {
    // Key share: the Problem cannot be deleted (e.g. by a review) before this commits.
    const [problem] = await tx
      .select({ id: problems.id })
      .from(problems)
      .where(eq(problems.id, problemId))
      .for("key share");
    if (!problem) return "missing";
    const [added] = await tx
      .insert(supports)
      .values({ problemId, userId, note })
      .onConflictDoNothing()
      .returning({ id: supports.id });
    if (!added) return "already_supported";
    await tx.insert(events).values({
      type: source === "submit" ? "request_deflected" : "support_added",
      actor: "user",
      actorId: userId,
      entityType: "problem",
      entityId: problemId,
      payload: { note: note !== null },
    });
    return "added";
  });
}
