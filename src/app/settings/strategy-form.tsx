"use client";

import { useActionState } from "react";
import { type StrategyState, updateStrategyAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const idle: StrategyState = { status: "idle" };

export function StrategyForm({ strategy }: { strategy: string }) {
  const [state, action, pending] = useActionState(updateStrategyAction, idle);

  return (
    <form action={action} className="space-y-2">
      <Label htmlFor="strategy">Strategy</Label>
      <p className="text-muted-foreground text-sm">
        The AI judges Strategic fit against this. Saving marks every score
        stale; nothing rescores until you ask.
      </p>
      <Textarea
        id="strategy"
        name="strategy"
        rows={14}
        maxLength={20000}
        defaultValue={strategy}
      />
      <Button type="submit" disabled={pending}>
        Save strategy
      </Button>
      {state.status === "saved" && <p role="status">Strategy saved.</p>}
      {state.status === "invalid" && (
        <p role="alert">Keep the strategy under 20,000 characters.</p>
      )}
      {state.status === "forbidden" && (
        <p role="alert">Only product managers can change the strategy.</p>
      )}
    </form>
  );
}
