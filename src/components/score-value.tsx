import { Badge } from "@/components/ui/badge";
import type { Score } from "@/domain/scoring";

/** An AI score as the ranking uses it: the PM's override beside the AI's value, and whether it is stale. */
export function ScoreValue({ score }: { score: Score | null }) {
  if (!score) return <span className="text-muted-foreground">Not scored</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="tabular-nums">{score.value}/5</span>
      {score.override && (
        <span className="text-muted-foreground text-xs">AI {score.ai}</span>
      )}
      {score.stale && <Badge variant="outline">Stale</Badge>}
    </span>
  );
}
