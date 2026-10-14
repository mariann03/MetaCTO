import { embed } from "ai";
import {
  and,
  asc,
  cosineDistance,
  count,
  desc,
  eq,
  inArray,
  type SQL,
  sql,
} from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  accounts,
  events,
  problemStatus,
  problems,
  requests,
  supports,
  users,
} from "@/db/schema";
import type { DbDeps, Deps } from "./deps";
import { embeddingText, findCandidates } from "./intake";

export const PROBLEM_STATUSES = problemStatus.enumValues;
export type ProblemStatus = (typeof PROBLEM_STATUSES)[number];
/** Decided Problems no longer compete for priority; planned ones still do. */
export const DECIDED: ProblemStatus[] = ["shipped", "declined"];
// ponytail: a fixed page of results; paginate when people need more than the closest few.
const SEARCH_RESULTS = 10;

/** Problems with how many people support them, and whether the viewer is one of them. */
function problemSummaries(db: Db, viewerId: number, where?: SQL) {
  return db
    .select({
      id: problems.id,
      statement: problems.statement,
      status: problems.status,
      supporters: count(supports.id),
      supported: sql<boolean>`coalesce(bool_or(${supports.userId} = ${viewerId}), false)`,
    })
    .from(problems)
    .leftJoin(supports, eq(supports.problemId, problems.id))
    .where(where)
    .groupBy(problems.id);
}

/** Every Problem, or those with one status, most supported first. */
export async function listProblems(
  { db }: DbDeps,
  { viewerId, status }: { viewerId: number; status?: ProblemStatus },
) {
  return problemSummaries(
    db,
    viewerId,
    status && eq(problems.status, status),
  ).orderBy(desc(count(supports.id)), asc(problems.id));
}

export type ProblemSummary = Awaited<ReturnType<typeof listProblems>>[number];

/**
 * A Problem as anyone may see it, with the requests behind it, oldest first. Requests are
 * anonymized: only the author's customer segment is shown, never who or which account.
 */
export async function getProblem(
  { db }: DbDeps,
  viewerId: number,
  problemId: number,
) {
  const [problem] = await problemSummaries(
    db,
    viewerId,
    eq(problems.id, problemId),
  );
  if (!problem) return null;
  const behind = await db
    .select({
      id: requests.id,
      title: requests.title,
      description: requests.description,
      segment: accounts.segment,
    })
    .from(requests)
    .innerJoin(users, eq(users.id, requests.authorId))
    .leftJoin(accounts, eq(accounts.id, users.accountId))
    .where(
      and(eq(requests.problemId, problemId), eq(requests.status, "submitted")),
    )
    .orderBy(asc(requests.createdAt), asc(requests.id));
  return { ...problem, requests: behind };
}

/** Summaries of ranked Problems, in their rank order, each with its similarity. */
async function rankedSummaries(
  db: Db,
  viewerId: number,
  ranked: { problemId: number; similarity: number }[],
) {
  if (ranked.length === 0) return [];
  const summaries = await problemSummaries(
    db,
    viewerId,
    inArray(
      problems.id,
      ranked.map((r) => r.problemId),
    ),
  );
  return ranked.flatMap(({ problemId, similarity }) => {
    const summary = summaries.find((s) => s.id === problemId);
    return summary ? [{ ...summary, similarity }] : [];
  });
}

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
  return rankedSummaries(db, viewerId, candidates);
}

/**
 * Explore search: Problems whose requests mean something close to the query, closest
 * first, each at its best-matching request. Embedding only, no LLM call.
 */
export async function searchProblems(
  { db, models }: Deps,
  {
    viewerId,
    query,
    status,
  }: { viewerId: number; query: string; status?: ProblemStatus },
) {
  const { embedding } = await embed({ model: models.embedding, value: query });
  const similarity = sql<number>`max(1 - (${cosineDistance(requests.embedding, embedding)}))`;
  // ponytail: scans every submitted request (no HNSW index use with the group by); fine for thousands, an index-backed top-k pool beyond.
  const ranked = await db
    .select({
      problemId: problems.id,
      similarity: similarity.mapWith(Number),
    })
    .from(requests)
    .innerJoin(problems, eq(problems.id, requests.problemId))
    .where(
      and(
        eq(requests.status, "submitted"),
        status && eq(problems.status, status),
      ),
    )
    .groupBy(problems.id)
    .orderBy(desc(similarity), asc(problems.id))
    .limit(SEARCH_RESULTS);
  return rankedSummaries(db, viewerId, ranked);
}

/** Where a +1 came from: the submit page (instead of filing a request), or Explore (its list or a Problem page). */
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
