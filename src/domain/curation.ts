import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  decisions,
  events,
  problems,
  problemVersions,
  requests,
  supports,
} from "@/db/schema";
import type { DbDeps } from "./deps";
import { requirePm } from "./directory";

/**
 * A PM folds a duplicate Problem (the source) into another (the target): its requests and
 * supports move over, and someone who supported both is counted once, keeping their note if
 * the target's support has none. The source is then deleted; the target's scores go stale
 * on their own, as its evidence changed. A source with a decision is refused, since its
 * updates and supporters' notifications would go with it: merge the other way round.
 */
export async function mergeProblems(
  { db }: DbDeps,
  {
    userId,
    sourceId,
    targetId,
  }: { userId: number; sourceId: number; targetId: number },
): Promise<"merged" | "invalid" | "decided"> {
  await requirePm({ db }, userId, "merge Problems");
  if (sourceId === targetId) return "invalid";
  return db.transaction(async (tx) => {
    // Both rows locked in id order, so concurrent merges and decisions wait their turn.
    const locked = await tx
      .select({ id: problems.id })
      .from(problems)
      .where(inArray(problems.id, [sourceId, targetId]))
      .orderBy(asc(problems.id))
      .for("update");
    if (locked.length !== 2) return "invalid";
    const [decided] = await tx
      .select({ id: decisions.id })
      .from(decisions)
      .where(eq(decisions.problemId, sourceId))
      .limit(1);
    if (decided) return "decided";

    const moved = await tx
      .update(requests)
      .set({ problemId: targetId })
      .where(eq(requests.problemId, sourceId))
      .returning({ id: requests.id });
    // A supporter of both keeps one support: the target's, with the source's note if it had none.
    await tx.execute(sql`
      update supports t set note = s.note
      from supports s
      where s.problem_id = ${sourceId} and t.problem_id = ${targetId}
        and t.user_id = s.user_id and t.note is null and s.note is not null`);
    await tx.execute(sql`
      delete from supports s using supports t
      where s.problem_id = ${sourceId} and t.problem_id = ${targetId}
        and t.user_id = s.user_id`);
    const kept = await tx
      .update(supports)
      .set({ problemId: targetId })
      .where(eq(supports.problemId, sourceId))
      .returning({ id: supports.id });
    await tx.delete(problems).where(eq(problems.id, sourceId));
    await tx.insert(events).values({
      type: "problem_merged",
      actor: "pm",
      actorId: userId,
      entityType: "problem",
      entityId: targetId,
      payload: { sourceId, requests: moved.length, supports: kept.length },
    });
    return "merged";
  });
}

/**
 * A PM rewrites a Problem's statement (a new version they authored) and sets whether it is
 * locked; the AI never rewrites a locked statement.
 */
export async function editStatement(
  { db }: DbDeps,
  {
    userId,
    problemId,
    statement,
    locked,
  }: { userId: number; problemId: number; statement: string; locked: boolean },
) {
  await requirePm({ db }, userId, "edit a statement");
  const text = statement.trim();
  if (!text) throw new Error("A statement cannot be empty");
  await db.transaction(async (tx) => {
    const [current] = await tx
      .select({
        statement: problems.statement,
        locked: problems.statementLocked,
      })
      .from(problems)
      .where(eq(problems.id, problemId))
      .for("update");
    if (!current) throw new Error(`Problem ${problemId} not found`);
    await tx
      .update(problems)
      .set({ statement: text, statementLocked: locked })
      .where(eq(problems.id, problemId));
    const record = (type: string) =>
      tx.insert(events).values({
        type,
        actor: "pm",
        actorId: userId,
        entityType: "problem",
        entityId: problemId,
        payload: {},
      });
    if (text !== current.statement) {
      await tx
        .insert(problemVersions)
        .values({ problemId, statement: text, author: "pm" });
      await record("statement_edited");
    }
    if (locked !== current.locked)
      await record(locked ? "statement_locked" : "statement_unlocked");
  });
}

/** Whether the AI is barred from rewriting the Problem's statement. */
export async function isStatementLocked({ db }: DbDeps, problemId: number) {
  const [problem] = await db
    .select({ locked: problems.statementLocked })
    .from(problems)
    .where(eq(problems.id, problemId));
  return problem?.locked ?? false;
}

/** Every version of a Problem's statement, newest first, with who wrote it. */
export async function listVersions({ db }: DbDeps, problemId: number) {
  return db
    .select({
      id: problemVersions.id,
      statement: problemVersions.statement,
      author: problemVersions.author,
      createdAt: problemVersions.createdAt,
    })
    .from(problemVersions)
    .where(eq(problemVersions.problemId, problemId))
    .orderBy(desc(problemVersions.createdAt), desc(problemVersions.id));
}
