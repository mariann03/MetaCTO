"use client";

import { useActionState, useId } from "react";
import {
  type ApproveState,
  approveUpdateAction,
  type DecisionState,
  type DraftState,
  draftUpdatesAction,
  recordDecisionAction,
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
/**
 * Records the PM's decision; the two update drafts follow, which takes a model call.
 * The server passes the options, so domain code stays out of the browser bundle.
 */
export function DecisionForm({
  problemId,
  options,
}: {
  problemId: number;
  options: { value: string; label: string }[];
}) {
  const statusId = useId();
  const rationaleId = useId();
  const [state, action, pending] = useActionState(
    (prev: DecisionState, form: FormData) =>
      recordDecisionAction(problemId, prev, form),
    { status: "idle" } as DecisionState,
  );
  return (
    <form action={action} className="space-y-3">
      <div className="space-y-1">
        <Label id={statusId}>Decision</Label>
        <Select name="status" items={options} defaultValue="planned">
          <SelectTrigger aria-labelledby={statusId} className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor={rationaleId}>Public rationale</Label>
        <p className="text-muted-foreground text-sm">
          Customers see this on the problem and in their update.
        </p>
        <Textarea
          id={rationaleId}
          name="rationale"
          rows={3}
          maxLength={2000}
          required
        />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Recording and drafting updates…" : "Record decision"}
      </Button>
      {state.status === "recorded" && (
        <p role="status" className="text-sm">
          Decision recorded. Review the drafts below.
        </p>
      )}
      {state.status === "draft_failed" && (
        <p role="alert" className="text-sm">
          Decision recorded, but drafting the updates failed. Draft them again
          below.
        </p>
      )}
      {state.status === "invalid" && (
        <p role="alert" className="text-destructive text-sm">
          Pick a decision and give a rationale.
        </p>
      )}
      {state.status === "forbidden" && (
        <p role="alert" className="text-destructive text-sm">
          Only product managers can record decisions.
        </p>
      )}
    </form>
  );
}

/** Drafts the latest decision's updates again, replacing drafts nobody approved. */
export function DraftUpdatesButton({ problemId }: { problemId: number }) {
  const [state, action, pending] = useActionState<DraftState>(
    () => draftUpdatesAction(problemId),
    { status: "idle" },
  );
  return (
    <form action={action} className="flex items-center gap-3">
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? "Drafting…" : "Draft updates"}
      </Button>
      {state.status === "failed" && (
        <p role="alert" className="text-destructive text-sm">
          Drafting failed. Try again.
        </p>
      )}
    </form>
  );
}

/** One AI draft: the PM edits it and approves it; nothing goes out before that. */
export function DraftForm({
  updateId,
  problemId,
  title,
  body,
}: {
  updateId: number;
  problemId: number;
  title: string;
  body: string;
}) {
  const bodyId = useId();
  const [state, action, pending] = useActionState(
    (prev: ApproveState, form: FormData) =>
      approveUpdateAction(updateId, problemId, prev, form),
    { status: "idle" } as ApproveState,
  );
  return (
    <form action={action} aria-label={title} className="space-y-2 p-4">
      <Label htmlFor={bodyId}>{title}</Label>
      <Textarea
        id={bodyId}
        name="body"
        rows={5}
        maxLength={5000}
        defaultValue={body}
        required
      />
      <Button type="submit" size="sm" disabled={pending}>
        Approve
      </Button>
      {state.status === "invalid" && (
        <p role="alert" className="text-destructive text-sm">
          Write the update before approving it.
        </p>
      )}
      {state.status === "already_approved" && (
        <p role="alert" className="text-sm">
          This update was already approved.
        </p>
      )}
      {state.status === "forbidden" && (
        <p role="alert" className="text-destructive text-sm">
          Only product managers can approve updates.
        </p>
      )}
    </form>
  );
}
