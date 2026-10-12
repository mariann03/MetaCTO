import Link from "next/link";
import { getSession } from "@/server/session";
import { UserSwitcher } from "./user-switcher";

export async function SiteHeader() {
  const { users, current } = await getSession();

  return (
    <header className="border-b">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4">
        <nav className="flex items-center gap-4 text-sm">
          <span className="font-semibold">Feature Intelligence</span>
          <Link href="/">Explore</Link>
          <Link href="/submit">Submit</Link>
          <Link href="/my-requests">My requests</Link>
          {current?.role === "pm" && (
            <>
              <Link href="/review">Review</Link>
              <Link href="/priorities">Priorities</Link>
              <Link href="/settings">Settings</Link>
            </>
          )}
        </nav>
        {current ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <span>Acting as</span>
            <UserSwitcher users={users} currentId={current.id} />
          </div>
        ) : (
          <span className="text-muted-foreground text-sm">
            No users yet. Run the seed.
          </span>
        )}
      </div>
    </header>
  );
}
