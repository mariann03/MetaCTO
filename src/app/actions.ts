"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { after } from "next/server";
import { z } from "zod";
import {
  approveUpdate,
  DECISIONS,
  draftUpdates,
  recordDecision,
} from "@/domain/decisions";
import {
  requestSplit,
  resubmitDraft,
  type SubmitResult,
  submitRequest,
} from "@/domain/intake";
import {
  addSupport,
  findMatches,
  SUPPORT_SOURCES,
  type SupportSource,
} from "@/domain/problems";
import { JUDGED } from "@/domain/ranking";
import { reviewRequest } from "@/domain/review";
import { overrideScore, rescoreProblem, rescoreStale } from "@/domain/scoring";
import { MATCH_MODES, setMatchMode, updateStrategy } from "@/domain/settings";
import { deps } from "@/server/deps";
import { getSession, USER_COOKIE } from "@/server/session";

export async function switchUser(userId: number) {
  const id = z.number().int().positive().parse(userId);
  (await cookies()).set(USER_COOKIE, String(id), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
}

// Lengths are checked on trimmed text, but the request is stored exactly as typed.
const requestInput = z.object({
  title: z
    .string()
    .refine((s) => s.trim().length >= 3, "Add a short title.")
    .max(200),
  description: z
    .string()
    .refine(
      (s) => s.trim().length >= 10,
      "Describe what you need in a sentence or two.",
    )
    .max(5000),
});

// React resets the form after every action, so text that was not saved is echoed back.
export type SubmitState = (
  | { status: "idle" }
  | SubmitResult
  | { status: "invalid"; errors: { title?: string[]; description?: string[] } }
) & { fields?: z.input<typeof requestInput> };

export async function submitRequestAction(
  _prev: SubmitState,
  form: FormData,
): Promise<SubmitState> {
  const fields = {
    title: String(form.get("title") ?? ""),
    description: String(form.get("description") ?? ""),
  };
  const parsed = requestInput.safeParse(fields);
  if (!parsed.success)
    return {
      status: "invalid",
      errors: z.flattenError(parsed.error).fieldErrors,
      fields,
    };

  const user = await currentUser();
  const result = await submitRequest(deps, {
    authorId: user.id,
    ...parsed.data,
  });
  revalidatePath("/my-requests");
  return result.status === "rate_limited" ? { ...result, fields } : result;
}

export async function resubmitDraftAction(
  requestId: number,
  _prev: SubmitState,
): Promise<SubmitState> {
  const user = await currentUser();
  const result = await resubmitDraft(deps, {
    userId: user.id,
    requestId: z.number().int().positive().parse(requestId),
  });
  revalidatePath("/my-requests");
  return result;
}

export interface SplitState {
  status: "idle" | "requested";
}

export async function requestSplitAction(
  requestId: number,
  _prev: SplitState,
): Promise<SplitState> {
  const user = await currentUser();
  await requestSplit(deps, {
    userId: user.id,
    requestId: z.number().int().positive().parse(requestId),
  });
  return { status: "requested" };
}

export interface MatchModeState {
  status: "idle" | "saved" | "forbidden";
}

export async function setMatchModeAction(
  _prev: MatchModeState,
  form: FormData,
): Promise<MatchModeState> {
  const user = await currentUser();
  if (user.role !== "pm") return { status: "forbidden" };
  const mode = z.enum(MATCH_MODES).parse(form.get("mode"));
  await setMatchMode(deps, { mode, userId: user.id });
  revalidatePath("/settings");
  return { status: "saved" };
}

const reviewInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("accept") }),
  z.object({ action: z.literal("split") }),
  z.object({
    action: z.literal("move"),
    problemId: z.coerce.number().int().positive(),
  }),
]);

export interface ReviewState {
  status: "idle" | "reviewed" | "already_reviewed" | "invalid" | "forbidden";
}

export async function reviewRequestAction(
  requestId: number,
  _prev: ReviewState,
  form: FormData,
): Promise<ReviewState> {
  const user = await currentUser();
  if (user.role !== "pm") return { status: "forbidden" };
  const decision = reviewInput.safeParse({
    action: form.get("action"),
    problemId: form.get("problemId"),
  });
  if (!decision.success) return { status: "invalid" };
  const status = await reviewRequest(deps, {
    userId: user.id,
    requestId: z.number().int().positive().parse(requestId),
    decision: decision.data,
  });
  revalidatePath("/review");
  revalidatePath("/my-requests");
  return { status };
}

export type Match = Awaited<ReturnType<typeof findMatches>>[number];

/** Problems resembling what the user is typing; embedding only, so it is cheap to call often. */
export async function findMatchesAction(
  title: string,
  description: string,
): Promise<Match[]> {
  const user = await currentUser();
  const text = z
    .object({ title: z.string().max(200), description: z.string().max(5000) })
    .parse({ title, description });
  if (`${text.title}${text.description}`.trim() === "") return [];
  return findMatches(deps, { viewerId: user.id, ...text });
}

export interface SupportState {
  status: "idle" | "invalid" | Awaited<ReturnType<typeof addSupport>>;
}

export async function addSupportAction(
  problemId: number,
  source: SupportSource,
  _prev: SupportState,
  form: FormData,
): Promise<SupportState> {
  const user = await currentUser();
  const note = z
    .string()
    .trim()
    .max(1000)
    .safeParse(String(form.get("note") ?? ""));
  if (!note.success) return { status: "invalid" };
  const status = await addSupport(deps, {
    userId: user.id,
    problemId: z.number().int().positive().parse(problemId),
    note: note.data === "" ? null : note.data,
    source: z.enum(SUPPORT_SOURCES).parse(source),
  });
  revalidatePath("/");
  return { status };
}

async function currentUser() {
  const { current } = await getSession();
  if (!current) throw new Error("No user selected");
  return current;
}

export interface StrategyState {
  status: "idle" | "saved" | "invalid" | "forbidden";
}

export async function updateStrategyAction(
  _prev: StrategyState,
  form: FormData,
): Promise<StrategyState> {
  const user = await currentUser();
  if (user.role !== "pm") return { status: "forbidden" };
  const strategy = z.string().max(20000).safeParse(form.get("strategy"));
  if (!strategy.success) return { status: "invalid" };
  await updateStrategy(deps, { userId: user.id, strategy: strategy.data });
  revalidatePath("/settings");
  revalidatePath("/priorities");
  return { status: "saved" };
}

export interface RescoreState {
  status: "idle" | "rescored" | "started" | "failed" | "forbidden";
}

export async function rescoreProblemAction(
  problemId: number,
): Promise<RescoreState> {
  const user = await currentUser();
  if (user.role !== "pm") return { status: "forbidden" };
  const id = z.number().int().positive().parse(problemId);
  try {
    await rescoreProblem(deps, { userId: user.id, problemId: id });
  } catch (error) {
    console.error(`Rescoring Problem ${id} failed`, error);
    return { status: "failed" };
  }
  revalidatePath(`/problems/${id}`);
  revalidatePath("/priorities");
  return { status: "rescored" };
}

/** Scores every stale or unscored Problem after responding: one model call each, minutes in all. */
export async function rescoreStaleAction(): Promise<RescoreState> {
  const user = await currentUser();
  if (user.role !== "pm") return { status: "forbidden" };
  // ponytail: no guard against a second click starting a second pass; record a running job if that wastes model time.
  after(() => rescoreStale(deps, { userId: user.id }));
  return { status: "started" };
}

const overrideInput = z.object({
  value: z.coerce.number().int().min(1).max(5),
  reason: z.string().trim().min(1).max(1000),
});

export interface OverrideState {
  status:
    | "idle"
    | "invalid"
    | "forbidden"
    | Awaited<ReturnType<typeof overrideScore>>;
}

export async function overrideScoreAction(
  problemId: number,
  criterion: string,
  _prev: OverrideState,
  form: FormData,
): Promise<OverrideState> {
  const user = await currentUser();
  if (user.role !== "pm") return { status: "forbidden" };
  const input = overrideInput.safeParse({
    value: form.get("value"),
    reason: form.get("reason"),
  });
  if (!input.success) return { status: "invalid" };
  const id = z.number().int().positive().parse(problemId);
  const status = await overrideScore(deps, {
    userId: user.id,
    problemId: id,
    criterion: z.enum(JUDGED).parse(criterion),
    ...input.data,
  });
  revalidatePath(`/problems/${id}`);
  revalidatePath("/priorities");
  return { status };
}

export interface DecisionState {
  status: "idle" | "recorded" | "draft_failed" | "invalid" | "forbidden";
}

export async function recordDecisionAction(
  problemId: number,
  _prev: DecisionState,
  form: FormData,
): Promise<DecisionState> {
  const user = await currentUser();
  if (user.role !== "pm") return { status: "forbidden" };
  const input = z
    .object({
      status: z.enum(DECISIONS),
      rationale: z.string().trim().min(1).max(2000),
    })
    .safeParse({
      status: form.get("status"),
      rationale: form.get("rationale"),
    });
  if (!input.success) return { status: "invalid" };
  const id = z.number().int().positive().parse(problemId);
  const { drafted } = await recordDecision(deps, {
    userId: user.id,
    problemId: id,
    ...input.data,
  });
  revalidatePath(`/problems/${id}`);
  revalidatePath("/priorities");
  return { status: drafted ? "recorded" : "draft_failed" };
}

export interface DraftState {
  status: "idle" | "drafted" | "failed" | "forbidden";
}

export async function draftUpdatesAction(
  problemId: number,
): Promise<DraftState> {
  const user = await currentUser();
  if (user.role !== "pm") return { status: "forbidden" };
  const id = z.number().int().positive().parse(problemId);
  try {
    await draftUpdates(deps, { userId: user.id, problemId: id });
  } catch (error) {
    console.error(`Drafting updates for Problem ${id} failed`, error);
    return { status: "failed" };
  }
  revalidatePath(`/problems/${id}`);
  return { status: "drafted" };
}

export interface ApproveState {
  status:
    | "idle"
    | "invalid"
    | "forbidden"
    | Awaited<ReturnType<typeof approveUpdate>>;
}

export async function approveUpdateAction(
  updateId: number,
  problemId: number,
  _prev: ApproveState,
  form: FormData,
): Promise<ApproveState> {
  const user = await currentUser();
  if (user.role !== "pm") return { status: "forbidden" };
  const body = z.string().trim().min(1).max(5000).safeParse(form.get("body"));
  if (!body.success) return { status: "invalid" };
  const status = await approveUpdate(deps, {
    userId: user.id,
    updateId: z.number().int().positive().parse(updateId),
    body: body.data,
  });
  revalidatePath(`/problems/${z.number().int().positive().parse(problemId)}`);
  revalidatePath("/notifications");
  return { status };
}
