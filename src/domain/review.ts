import { and, asc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { events, problems, requests, supports } from "@/db/schema";
import type { DbDeps, Deps } from "./deps";
import { requirePm } from "./directory";
import { insertProblem, refineStatement } from "./intake";

/**
 * What a PM reviews: groupings the AI was unsure about (medium), the starts of new Problems
 * (low), and groupings their submitter disputed; each until a PM accepts, moves or splits it.
 */
const needsReview = and(
  eq(requests.status, "submitted"),
  isNull(requests.reviewedAt),
  or(
    inArray(requests.tier, ["medium", "low"]),
    isNotNull(requests.splitRequestedAt),
  ),
);

/** Why an item is in the queue. */
export type ReviewReason = "split_requested" | "new_problem" | "grouping";

/** The review queue, oldest first, with the evidence intake decided on. */
export async function listReviewQueue({ db }: DbDeps) {
  const rows = await db
    .select({
      id: requests.id,
      title: requests.title,
      description: requests.description,
      tier: requests.tier,
      analysis: requests.analysis,
      splitRequested: sql<boolean>`${requests.splitRequestedAt} is not null`,
      problemId: problems.id,
      statement: problems.statement,
    })
    .from(requests)
    .innerJoin(problems, eq(requests.problemId, problems.id))
    .where(needsReview)
    .orderBy(asc(requests.createdAt), asc(requests.id));

  // Candidates are shown with their current statements; ones merged away since are left out.
  const candidateIds = [
    ...new Set(
      rows.flatMap((r) => r.analysis?.candidates.map((c) => c.problemId) ?? []),
    ),
  ];
  const statements = new Map(
    candidateIds.length === 0
      ? []
      : (
          await db
            .select({ id: problems.id, statement: problems.statement })
            .from(problems)
            .where(inArray(problems.id, candidateIds))
        ).map((p) => [p.id, p.statement]),
  );

  return rows.map(({ problemId, statement, analysis, tier, ...request }) => {
    const match = analysis?.match ?? null;
    const candidates = (analysis?.candidates ?? []).flatMap((c) => {
      const current = statements.get(c.problemId);
      return current === undefined ? [] : [{ ...c, statement: current }];
    });
    const named = analysis?.candidates.find(
      (c) => c.problemId === match?.problemId,
    );
    const reason: ReviewReason = request.splitRequested
      ? "split_requested"
      : tier === "low"
        ? "new_problem"
        : "grouping";
    return {
      id: request.id,
      title: request.title,
      description: request.description,
      reason,
      problem: { id: problemId, statement },
      match,
      // The model says same, but the similarity is below the review threshold.
      signalsDisagree:
        match?.verdict === "same_problem" &&
        named !== undefined &&
        analysis !== null &&
        named.similarity < analysis.thresholds.low,
      candidates,
    };
  });
}

export type ReviewItem = Awaited<ReturnType<typeof listReviewQueue>>[number];

/** Every Problem, for choosing where to move a request. */
export async function listProblems({ db }: DbDeps) {
  return db
    .select({ id: problems.id, statement: problems.statement })
    .from(problems)
    .orderBy(asc(problems.id));
}

/** accept: the AI's placement stands; move: into another Problem; split: into a new Problem. */
export type ReviewDecision =
  | { action: "accept" }
  | { action: "move"; problemId: number }
  | { action: "split" };

/**
 * A PM's review of one queue item. Accepting a medium grouping folds the request into the
 * Problem's statement, as a high-tier attach does; moving and splitting are overrides.
 * An item already reviewed (e.g. by another PM) is left as it is.
 */
export async function reviewRequest(
  deps: Deps,
  {
    userId,
    requestId,
    decision,
  }: { userId: number; requestId: number; decision: ReviewDecision },
): Promise<"reviewed" | "already_reviewed"> {
  await requirePm(deps, userId, "review requests");
  const claimed = await deps.db.transaction(async (tx) => {
    const [request] = await tx
      .update(requests)
      .set({ reviewedAt: sql`now()` })
      .where(and(eq(requests.id, requestId), needsReview))
      .returning();
    if (!request) return null;
    const from = request.problemId;
    if (from === null) throw new Error(`Request ${requestId} has no Problem`);

    if (decision.action === "accept") {
      await tx.insert(events).values({
        type: "review_accepted",
        actor: "pm",
        actorId: userId,
        entityType: "request",
        entityId: requestId,
        payload: { problemId: from },
      });
      return { request, problemId: from };
    }

    let to: number;
    if (decision.action === "move") {
      to = decision.problemId;
      if (to === from)
        throw new Error(`Request ${requestId} is already in Problem ${to}`);
    } else {
      if (!request.analysis)
        throw new Error(`Request ${requestId} has no analysis`);
      to = await insertProblem(tx, request.analysis.problemStatement);
      await tx.insert(events).values({
        type: "problem_created",
        actor: "pm",
        actorId: userId,
        entityType: "problem",
        entityId: to,
        payload: { requestId },
      });
    }
    await reassign(tx, request, from, to);
    await tx.insert(events).values({
      type: "grouping_overridden",
      actor: "pm",
      actorId: userId,
      entityType: "request",
      entityId: requestId,
      payload: {
        action: decision.action,
        fromProblemId: from,
        toProblemId: to,
      },
    });
    return { request, problemId: to };
  });
  if (!claimed) return "already_reviewed";
  // Accepting confirms the grouping: only now may a medium one change the statement.
  if (decision.action === "accept" && claimed.request.tier === "medium")
    await refineStatement(deps, claimed.problemId, claimed.request);
  return "reviewed";
}

/**
 * Moves a request, and the author's support that came with it, into another Problem.
 * The author still supports the old Problem through another of their requests there, if any;
 * a Problem left without requests is deleted.
 */
async function reassign(
  tx: Tx,
  request: { id: number; authorId: number },
  from: number,
  to: number,
) {
  await tx
    .update(requests)
    .set({ problemId: to })
    .where(eq(requests.id, request.id));
  const [remaining] = await tx
    .select({ id: requests.id })
    .from(requests)
    .where(
      and(
        eq(requests.problemId, from),
        eq(requests.authorId, request.authorId),
      ),
    )
    .limit(1);
  if (remaining)
    await tx
      .update(supports)
      .set({ requestId: remaining.id })
      .where(eq(supports.requestId, request.id));
  else await tx.delete(supports).where(eq(supports.requestId, request.id));
  await tx
    .insert(supports)
    .values({ problemId: to, userId: request.authorId, requestId: request.id })
    .onConflictDoNothing();

  const [left] = await tx
    .select({ id: requests.id })
    .from(requests)
    .where(eq(requests.problemId, from))
    .limit(1);
  if (!left) await tx.delete(problems).where(eq(problems.id, from));
}
