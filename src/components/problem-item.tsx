import Link from "next/link";
import type { ProblemSummary } from "@/domain/problems";
import { plural } from "@/lib/utils";
import { ProblemStatusBadge } from "./problem-status";
import { SupportButton, type SupportButtonProps } from "./support-button";

/** A Problem in a list (Explore, live matches): statement, status, supporters and +1. */
export function ProblemItem({
  problem,
  source,
  onSupported,
}: {
  problem: ProblemSummary;
  source: SupportButtonProps["source"];
  onSupported?: () => void;
}) {
  return (
    <li aria-label={problem.statement} className="space-y-2 p-4">
      <div className="flex items-start justify-between gap-4">
        <Link href={`/problems/${problem.id}`} className="font-medium">
          {problem.statement}
        </Link>
        <ProblemStatusBadge status={problem.status} />
      </div>
      <p className="text-muted-foreground text-sm">
        {plural(problem.supporters, "supporter")}
      </p>
      <SupportButton
        problemId={problem.id}
        source={source}
        supported={problem.supported}
        onAdded={onSupported}
      />
    </li>
  );
}
