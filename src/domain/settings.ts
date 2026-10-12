import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { events, settings } from "@/db/schema";
import type { DbDeps } from "./deps";
import { requirePm } from "./directory";

/** Settings rows by key; every setting lives in the key/value `settings` table. */
const KEYS = { strategy: "strategy", matchMode: "matchMode" } as const;

/** hybrid: embedding similarity plus the model's verdict; similarity-only: thresholds alone. */
export const MATCH_MODES = ["hybrid", "similarity-only"] as const;
export type MatchMode = (typeof MATCH_MODES)[number];

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

export async function getStrategy({ db }: DbDeps): Promise<string> {
  const value = await readSetting(db, KEYS.strategy);
  return typeof value === "string" ? value : "";
}

export async function getMatchMode({ db }: DbDeps): Promise<MatchMode> {
  const value = await readSetting(db, KEYS.matchMode);
  return MATCH_MODES.find((mode) => mode === value) ?? "hybrid";
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
