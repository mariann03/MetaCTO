import { getSession } from "@/server/session";
import { UserSwitcher } from "./user-switcher";

export async function SiteHeader() {
  const { users, current } = await getSession();

  return (
    <header className="border-b">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4">
        <span className="font-semibold">Feature Intelligence</span>
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
