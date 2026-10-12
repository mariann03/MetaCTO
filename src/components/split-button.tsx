"use client";

import { useActionState } from "react";
import { requestSplitAction, type SplitState } from "@/app/actions";
import { Button } from "@/components/ui/button";

const idle: SplitState = { status: "idle" };

/** "Not the same? Split it out": the submitter disputes a grouping for a PM to review. */
export function SplitButton({ requestId }: { requestId: number }) {
  const [state, action, pending] = useActionState(
    requestSplitAction.bind(null, requestId),
    idle,
  );
  if (state.status === "requested")
    return <p>Thanks. A product manager will review the grouping.</p>;

  return (
    <form action={action}>
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        Not the same? Split it out
      </Button>
    </form>
  );
}
