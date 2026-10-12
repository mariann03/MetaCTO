"use server";

import { cookies } from "next/headers";
import { z } from "zod";
import { USER_COOKIE } from "@/server/session";

export async function switchUser(userId: number) {
  const id = z.number().int().positive().parse(userId);
  (await cookies()).set(USER_COOKIE, String(id), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
}
