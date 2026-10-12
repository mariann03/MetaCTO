"use client";

import { useActionState } from "react";
import { type ReviewState, reviewRequestAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ProblemOption } from "@/domain/review";

const idle: ReviewState = { status: "idle" };

/**
 * Accept, split or move one queue item; the submit button pressed names the action.
 * Every item gets the same `problems` list (sent once), offered with the AI's candidates first.
 */
export function ReviewActions({
  requestId,
  canSplit,
  problems,
  currentProblemId,
  suggestedIds,
}: {
  requestId: number;
  canSplit: boolean;
  problems: ProblemOption[];
  currentProblemId: number;
  suggestedIds: number[];
}) {
  const [state, action, pending] = useActionState(
    reviewRequestAction.bind(null, requestId),
    idle,
  );
  const rank = (id: number) => {
    const i = suggestedIds.indexOf(id);
    return i === -1 ? suggestedIds.length : i;
  };
  const targets = problems
    .filter((p) => p.id !== currentProblemId)
    .sort((a, b) => rank(a.id) - rank(b.id))
    .map((p) => ({ value: String(p.id), label: p.statement }));

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <Button type="submit" name="action" value="accept" disabled={pending}>
        Accept
      </Button>
      {canSplit && (
        <Button
          type="submit"
          name="action"
          value="split"
          variant="outline"
          disabled={pending}
        >
          Split into a new problem
        </Button>
      )}
      <Select name="problemId" items={targets}>
        <SelectTrigger aria-label="Move to problem" className="w-80">
          <SelectValue placeholder="Move to another problem…" />
        </SelectTrigger>
        <SelectContent>
          {targets.map((t) => (
            <SelectItem key={t.value} value={t.value}>
              {t.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        type="submit"
        name="action"
        value="move"
        variant="outline"
        disabled={pending}
      >
        Move
      </Button>
      {state.status === "invalid" && (
        <p role="alert">Choose a problem to move it to.</p>
      )}
      {state.status === "already_reviewed" && (
        <p role="status">Another product manager already reviewed this.</p>
      )}
      {state.status === "forbidden" && (
        <p role="alert">Only product managers can review requests.</p>
      )}
    </form>
  );
}
