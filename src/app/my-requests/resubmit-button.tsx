"use client";

import { useActionState } from "react";
import { resubmitDraftAction, type SubmitState } from "@/app/actions";
import { SubmitResultMessage } from "@/components/submit-result";
import { Button } from "@/components/ui/button";

const idle: SubmitState = { status: "idle" };

export function ResubmitButton({ requestId }: { requestId: number }) {
  const [state, action, pending] = useActionState(
    resubmitDraftAction.bind(null, requestId),
    idle,
  );

  return (
    <form action={action} className="space-y-2">
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? "Analyzing…" : "Submit again"}
      </Button>
      <SubmitResultMessage state={state} />
    </form>
  );
}
