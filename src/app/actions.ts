"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import {
  resubmitDraft,
  type SubmitResult,
  submitRequest,
} from "@/domain/intake";
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

export type SubmitState =
  | { status: "idle" }
  | SubmitResult
  | { status: "invalid"; errors: { title?: string[]; description?: string[] } };

export async function submitRequestAction(
  _prev: SubmitState,
  form: FormData,
): Promise<SubmitState> {
  const parsed = requestInput.safeParse(Object.fromEntries(form));
  if (!parsed.success)
    return {
      status: "invalid",
      errors: z.flattenError(parsed.error).fieldErrors,
    };

  const user = await currentUser();
  const result = await submitRequest(deps, {
    authorId: user.id,
    ...parsed.data,
  });
  revalidatePath("/my-requests");
  return result;
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

async function currentUser() {
  const { current } = await getSession();
  if (!current) throw new Error("No user selected");
  return current;
}
