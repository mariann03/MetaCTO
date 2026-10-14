import { Badge } from "@/components/ui/badge";
import type { ProblemStatus } from "@/domain/problems";
import { STATUS_LABELS } from "@/lib/labels";

export function ProblemStatusBadge({ status }: { status: ProblemStatus }) {
  return (
    <Badge variant={status === "open" ? "outline" : "secondary"}>
      {STATUS_LABELS[status]}
    </Badge>
  );
}
