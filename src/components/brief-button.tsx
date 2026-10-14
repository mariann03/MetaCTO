"use client";

import { useActionState } from "react";
import { type BriefState, generateBriefAction } from "@/app/actions";
import { Button } from "@/components/ui/button";

/** Starts the brief agent in the background; it reads the evidence for a few minutes. */
export function BriefButton({
  problemId,
  again,
}: {
  problemId: number;
  again: boolean;
}) {
  const [state, action, pending] = useActionState<BriefState>(
    () => generateBriefAction(problemId),
    { status: "idle" },
  );
  if (state.status === "started")
    return (
      <p role="status" className="text-sm">
        Gathering the evidence. This takes a few minutes; reload to see the
        brief.
      </p>
    );
  return (
    <form action={action} className="flex items-center gap-3">
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {again ? "Generate a new brief" : "Generate brief"}
      </Button>
      {state.status === "forbidden" && (
        <p role="alert" className="text-destructive text-sm">
          Only product managers can generate briefs.
        </p>
      )}
    </form>
  );
}
