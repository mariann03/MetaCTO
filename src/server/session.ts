import "server-only";
import { cookies } from "next/headers";
import { listUsers } from "@/domain/directory";
import { deps } from "./deps";

export const USER_COOKIE = "uid";

/** Role switcher stand-in for auth: the cookie picks a seeded user. */
export async function getSession() {
  // Cookie first: it ends prerendering, so the query never runs at build time.
  const id = Number((await cookies()).get(USER_COOKIE)?.value);
  const users = await listUsers(deps);
  const current = users.find((u) => u.id === id) ?? users[0] ?? null;
  return { users, current };
}
