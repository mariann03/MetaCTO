"use client";

import { useActionState, useId, useState } from "react";
import {
  type OverrideState,
  overrideScoreAction,
  type RescoreState,
  rescoreProblemAction,
  rescoreStaleAction,
} from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { Judged } from "@/domain/ranking";

const idle = { status: "idle" } as const;
const VALUES = [1, 2, 3, 4, 5].map((v) => ({
  value: String(v),
  label: String(v),
}));

/** Spends one model call rescoring this Problem; takes seconds on local models. */
export function RescoreButton({ problemId }: { problemId: number }) {
  const [state, action, pending] = useActionState<RescoreState>(
    () => rescoreProblemAction(problemId),
    idle,
  );
  return (
    <form action={action} className="flex items-center gap-3">
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? "Rescoring…" : "Rescore"}
      </Button>
      {state.status === "rescored" && (
        <p role="status" className="text-sm">
          Rescored.
        </p>
      )}
      {state.status === "failed" && (
        <p role="alert" className="text-destructive text-sm">
          Scoring failed. Try again.
        </p>
      )}
    </form>
  );
}

/** Rescores every stale or unscored Problem in the background, one model call each. */
export function RescoreStaleButton({ due }: { due: number }) {
  const [state, action, pending] = useActionState<RescoreState>(
    () => rescoreStaleAction(),
    idle,
  );
  if (state.status === "started")
    return (
      <p role="status" className="text-sm">
        Rescoring {due} problems in the background. Reload to see new scores.
      </p>
    );
  return (
    <form action={action}>
      <Button type="submit" size="sm" disabled={pending || due === 0}>
        Rescore all stale ({due})
      </Button>
    </form>
  );
}

/** Replaces an AI score with the PM's, saying why. */
export function OverrideForm({
  problemId,
  criterion,
  name,
}: {
  problemId: number;
  criterion: Judged;
  name: string;
}) {
  const reasonId = useId();
  const valueId = useId();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(
    (prev: OverrideState, form: FormData) =>
      overrideScoreAction(problemId, criterion, prev, form),
    idle as OverrideState,
  );
  if (state.status === "overridden")
    return (
      <p role="status" className="text-sm">
        Override saved.
      </p>
    );
  if (!open)
    return (
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        Override {name}
      </Button>
    );
  return (
    <form action={action} className="space-y-2">
      <div className="space-y-1">
        <Label id={valueId}>Your score</Label>
        <Select name="value" items={VALUES} defaultValue="3">
          <SelectTrigger aria-labelledby={valueId} className="w-20">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {VALUES.map((v) => (
              <SelectItem key={v.value} value={v.value}>
                {v.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor={reasonId}>Why? (required)</Label>
        <Textarea
          id={reasonId}
          name="reason"
          rows={2}
          maxLength={1000}
          required
        />
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        Save override
      </Button>
      {state.status === "invalid" && (
        <p role="alert" className="text-destructive text-sm">
          Pick a score from 1 to 5 and say why.
        </p>
      )}
      {state.status === "unscored" && (
        <p role="alert" className="text-destructive text-sm">
          Score this problem before overriding it.
        </p>
      )}
    </form>
  );
}
