"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import {
  requestSplit,
  resubmitDraft,
  type SubmitResult,
  submitRequest,
} from "@/domain/intake";
import { addSupport, findMatches, type SupportSource } from "@/domain/problems";
import { reviewRequest } from "@/domain/review";
import { MATCH_MODES, setMatchMode } from "@/domain/settings";
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
  status: "idle" | Awaited<ReturnType<typeof addSupport>>;
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
    .max(1000)
    .parse(String(form.get("note") ?? ""))
    .trim();
  const status = await addSupport(deps, {
    userId: user.id,
    problemId: z.number().int().positive().parse(problemId),
    note: note === "" ? null : note,
    source: z.enum(["submit", "explore"]).parse(source),
  });
  revalidatePath("/");
  return { status };
}

async function currentUser() {
  const { current } = await getSession();
  if (!current) throw new Error("No user selected");
  return current;
}
