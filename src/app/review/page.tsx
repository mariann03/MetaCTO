import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Verdict } from "@/domain/intake";
import { listProblems, type ProblemSummary } from "@/domain/problems";
import {
  listReviewQueue,
  type ReviewItem,
  type ReviewReason,
} from "@/domain/review";
import { deps } from "@/server/deps";
import { getSession } from "@/server/session";
import { ReviewActions } from "./review-actions";

const REASON: Record<ReviewReason, string> = {
  grouping: "Review grouping",
  new_problem: "New problem",
  split_requested: "Split requested",
};

// A page of the oldest items; the rest show up as these are reviewed.
const PAGE_SIZE = 25;

const VERDICT: Record<Verdict, string> = {
  same_problem: "Same problem",
  related_but_different: "Related, not the same",
  different: "Different",
};

export default function ReviewPage() {
  return (
    <section className="space-y-6">
      <h1 className="font-semibold text-2xl">Review queue</h1>
      <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
        <Queue />
      </Suspense>
    </section>
  );
}

async function Queue() {
  const { current } = await getSession();
  if (current?.role !== "pm")
    return (
      <p className="text-muted-foreground">
        Only product managers can review requests.
      </p>
    );

  const [queue, problems] = await Promise.all([
    listReviewQueue(deps),
    listProblems(deps, { viewerId: current.id }),
  ]);
  if (queue.length === 0)
    return <p className="text-muted-foreground">Nothing to review.</p>;

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        {queue.length > PAGE_SIZE
          ? `Showing the oldest ${PAGE_SIZE} of ${queue.length} to review.`
          : `${queue.length} to review.`}
      </p>
      <ul className="space-y-4">
        {queue.slice(0, PAGE_SIZE).map((item) => (
          <li key={item.id} aria-label={item.title}>
            <QueueItem item={item} problems={problems} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function QueueItem({
  item,
  problems,
}: {
  item: ReviewItem;
  problems: ProblemSummary[];
}) {
  const { match } = item;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{item.title}</CardTitle>
        <CardDescription>{item.description}</CardDescription>
        <CardAction className="flex gap-2">
          {item.signalsDisagree && (
            <Badge variant="outline">Signals disagree</Badge>
          )}
          <Badge variant="secondary">{REASON[item.reason]}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p>
          <span className="text-muted-foreground">In problem: </span>
          {item.problem.statement}
        </p>
        <p>
          <span className="text-muted-foreground">AI verdict: </span>
          {match
            ? `${VERDICT[match.verdict]}. ${match.rationale}`
            : "None (similarity only, or no earlier problems)"}
        </p>
        {item.candidates.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Closest problems</TableHead>
                <TableHead className="text-right">Similarity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {item.candidates.map((c) => (
                <TableRow key={c.problemId}>
                  <TableCell className="whitespace-normal">
                    {c.statement}
                    {c.problemId === item.problem.id && (
                      <Badge variant="outline" className="ml-2">
                        Current
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {c.similarity.toFixed(2)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <CardFooter>
        <ReviewActions
          requestId={item.id}
          canSplit={item.reason !== "new_problem"}
          problems={problems}
          currentProblemId={item.problem.id}
          suggestedIds={item.candidates.map((c) => c.problemId)}
        />
      </CardFooter>
    </Card>
  );
}
