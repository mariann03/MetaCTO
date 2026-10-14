import Link from "next/link";
import { Suspense } from "react";
import { listNotifications } from "@/domain/decisions";
import { deps } from "@/server/deps";
import { getSession } from "@/server/session";

const dateFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

export default function NotificationsPage() {
  return (
    <section className="space-y-6">
      <h1 className="font-semibold text-2xl">Notifications</h1>
      <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
        <NotificationList />
      </Suspense>
    </section>
  );
}

async function NotificationList() {
  const { current } = await getSession();
  const mine = current ? await listNotifications(deps, current.id) : [];
  if (mine.length === 0)
    return (
      <p className="text-muted-foreground">
        No updates yet. When a problem you support gets a status update, it
        appears here.
      </p>
    );

  // ponytail: no read/unread state; add one when people need to tell new updates apart.
  return (
    <ul className="divide-y rounded-md border">
      {mine.map((n) => (
        <li key={n.id} className="space-y-1 p-4">
          <Link href={`/problems/${n.problemId}`} className="font-medium">
            {n.statement}
          </Link>
          <p className="whitespace-pre-line">{n.body}</p>
          <p className="text-muted-foreground text-xs">
            {dateFormat.format(n.createdAt)}
          </p>
        </li>
      ))}
    </ul>
  );
}
