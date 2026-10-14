import { eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { events, settings } from "@/db/schema";
import type { DbDeps } from "./deps";
import { requirePm } from "./directory";

/** Settings rows by key; every setting lives in the key/value `settings` table. */
const KEYS = {
  strategy: "strategy",
  matchMode: "matchMode",
  maxClarifyingQuestions: "maxClarifyingQuestions",
} as const;

/** How many clarifying questions a submitter may be asked; 0 turns them off. */
export const MAX_CLARIFYING_QUESTIONS = 3;
const DEFAULT_CLARIFYING_QUESTIONS = 1;

/** hybrid: embedding similarity plus the model's verdict; similarity-only: thresholds alone. */
export const MATCH_MODES = ["hybrid", "similarity-only"] as const;
export type MatchMode = (typeof MATCH_MODES)[number];

// The strategy document in SQL, so scoring reads it in the same statement as the evidence.
export const strategyText = sql<string>`coalesce((select st.value #>> '{}' from settings st where st.key = ${KEYS.strategy}), '')`;
/** Changes whenever the strategy does; a score made under another strategy is stale. */
export const strategyFingerprint = sql<string>`md5(${strategyText})`;

async function readSetting(db: Db, key: string): Promise<unknown> {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, key));
  return row?.value;
}

/** Stores the strategy document; seeding and the PM editor both write it. */
export async function writeStrategy(db: Pick<Db, "insert">, strategy: string) {
  await db
    .insert(settings)
    .values({ key: KEYS.strategy, value: strategy })
    .onConflictDoUpdate({ target: settings.key, set: { value: strategy } });
}

/** The PM edits the strategy; every AI score made under the old one becomes stale. */
export async function updateStrategy(
  { db }: DbDeps,
  { userId, strategy }: { userId: number; strategy: string },
) {
  await requirePm({ db }, userId, "change the strategy");
  await db.transaction(async (tx) => {
    await writeStrategy(tx, strategy);
    await tx.insert(events).values({
      type: "strategy_updated",
      actor: "pm",
      actorId: userId,
      entityType: "setting",
      entityId: 0,
      payload: {},
    });
  });
}

export async function getStrategy({ db }: DbDeps): Promise<string> {
  const value = await readSetting(db, KEYS.strategy);
  return typeof value === "string" ? value : "";
}

export async function getMatchMode({ db }: DbDeps): Promise<MatchMode> {
  const value = await readSetting(db, KEYS.matchMode);
  return MATCH_MODES.find((mode) => mode === value) ?? "hybrid";
}

export async function getMaxClarifyingQuestions({ db }: DbDeps) {
  const value = await readSetting(db, KEYS.maxClarifyingQuestions);
  return typeof value === "number" ? value : DEFAULT_CLARIFYING_QUESTIONS;
}

/** PMs set how many clarifying questions submitters may be asked (e.g. to compare 0 and 1). */
export async function setMaxClarifyingQuestions(
  { db }: DbDeps,
  { userId, max }: { userId: number; max: number },
) {
  await requirePm({ db }, userId, "change the clarifying questions");
  if (!Number.isInteger(max) || max < 0 || max > MAX_CLARIFYING_QUESTIONS)
    throw new Error(
      `Between 0 and ${MAX_CLARIFYING_QUESTIONS} questions, not ${max}`,
    );
  await db.transaction(async (tx) => {
    await tx
      .insert(settings)
      .values({ key: KEYS.maxClarifyingQuestions, value: max })
      .onConflictDoUpdate({ target: settings.key, set: { value: max } });
    await tx.insert(events).values({
      type: "max_clarifying_questions_changed",
      actor: "pm",
      actorId: userId,
      entityType: "setting",
      entityId: 0,
      payload: { max },
    });
  });
}

/** PMs switch between hybrid and similarity-only matching (e.g. to compare them). */
export async function setMatchMode(
  { db }: DbDeps,
  { mode, userId }: { mode: MatchMode; userId: number },
) {
  await requirePm({ db }, userId, "change the matching mode");
  await db.transaction(async (tx) => {
    await tx
      .insert(settings)
      .values({ key: KEYS.matchMode, value: mode })
      .onConflictDoUpdate({ target: settings.key, set: { value: mode } });
    await tx.insert(events).values({
      type: "match_mode_changed",
      actor: "pm",
      actorId: userId,
      // Settings have no row id; 0 stands for "the workspace".
      entityType: "setting",
      entityId: 0,
      payload: { mode },
    });
  });
}
