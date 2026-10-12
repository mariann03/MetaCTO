import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { listMyRequests } from "@/domain/intake";
import { deps } from "@/server/deps";
import { getSession } from "@/server/session";
import { ResubmitButton } from "./resubmit-button";

export default function MyRequestsPage() {
  return (
    <section className="space-y-6">
      <h1 className="font-semibold text-2xl">My requests</h1>
      <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
        <RequestList />
      </Suspense>
    </section>
  );
}

async function RequestList() {
  const { current } = await getSession();
  const mine = current ? await listMyRequests(deps, current.id) : [];
  if (mine.length === 0)
    return (
      <p className="text-muted-foreground">
        You haven't submitted any requests yet.
      </p>
    );

  return (
    <ul className="divide-y rounded-md border">
      {mine.map((request) => (
        <li key={request.id} className="space-y-2 p-4">
          <div className="flex items-center justify-between gap-4">
            <span className="font-medium">{request.title}</span>
            <Badge
              variant={request.status === "draft" ? "outline" : "secondary"}
            >
              {request.status === "draft" ? "Draft" : "Submitted"}
            </Badge>
          </div>
          {request.problem ? (
            <p className="text-muted-foreground text-sm">
              Problem: {request.problem.statement}
            </p>
          ) : (
            <ResubmitButton requestId={request.id} />
          )}
        </li>
      ))}
    </ul>
  );
}
