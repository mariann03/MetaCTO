import { Suspense } from "react";
import { SplitButton } from "@/components/split-button";
import { Badge } from "@/components/ui/badge";
import { listMyRequests } from "@/domain/intake";
import { deps } from "@/server/deps";
import { getSession } from "@/server/session";
import { ResubmitButton } from "./resubmit-button";

const STATUS = {
  draft: { label: "Draft", variant: "outline" },
  analyzing: { label: "Analyzing…", variant: "outline" },
  submitted: { label: "Submitted", variant: "secondary" },
} as const;

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
            <Badge variant={STATUS[request.status].variant}>
              {STATUS[request.status].label}
            </Badge>
          </div>
          {request.problem && (
            <p className="text-muted-foreground text-sm">
              Problem: {request.problem.statement}
            </p>
          )}
          {request.status === "draft" && (
            <ResubmitButton requestId={request.id} />
          )}
          {request.canSplit && <SplitButton requestId={request.id} />}
          {request.splitRequested && (
            <p className="text-muted-foreground text-sm">
              Split requested. A product manager will review the grouping.
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
