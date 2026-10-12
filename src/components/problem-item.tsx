import type { ProblemSummary } from "@/domain/problems";
import { SupportButton, type SupportButtonProps } from "./support-button";

/** A Problem in a list (Explore, live matches): statement, supporters and +1. */
export function ProblemItem({
  problem,
  source,
  onSupported,
}: {
  problem: ProblemSummary;
  source: SupportButtonProps["source"];
  onSupported?: () => void;
}) {
  const { supporters } = problem;
  return (
    <li aria-label={problem.statement} className="space-y-2 p-4">
      <p className="font-medium">{problem.statement}</p>
      <p className="text-muted-foreground text-sm">
        {supporters} supporter{supporters === 1 ? "" : "s"}
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
