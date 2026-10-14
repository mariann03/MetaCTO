"use client";

import { useActionState, useId } from "react";
import {
  editStatementAction,
  type MergeState,
  mergeProblemsAction,
  type StatementState,
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

/** The PM rewrites the statement and decides whether the AI may still refine it. */
export function StatementForm({
  problemId,
  statement,
  locked,
}: {
  problemId: number;
  statement: string;
  locked: boolean;
}) {
  const statementId = useId();
  const lockId = useId();
  const [state, action, pending] = useActionState(
    (prev: StatementState, form: FormData) =>
      editStatementAction(problemId, prev, form),
    { status: "idle" } as StatementState,
  );
  return (
    <form action={action} className="space-y-2">
      <Label htmlFor={statementId}>Statement</Label>
      <Textarea
        id={statementId}
        name="statement"
        rows={3}
        maxLength={1000}
        defaultValue={statement}
        required
      />
      <div className="flex items-center gap-2">
        <input
          id={lockId}
          name="locked"
          type="checkbox"
          defaultChecked={locked}
          className="size-4"
        />
        <Label htmlFor={lockId}>Locked: the AI never rewrites it</Label>
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        Save statement
      </Button>
      {state.status === "saved" && (
        <p role="status" className="text-sm">
          Statement saved.
        </p>
      )}
      {state.status === "missing" && (
        <p role="alert" className="text-sm">
          This problem was merged into another. Reload to find it.
        </p>
      )}
      {state.status === "invalid" && (
        <p role="alert" className="text-destructive text-sm">
          Write a statement of up to 1,000 characters.
        </p>
      )}
      {state.status === "forbidden" && (
        <p role="alert" className="text-destructive text-sm">
          Only product managers can edit statements.
        </p>
      )}
    </form>
  );
}

/** Folds this Problem into another one the AI should have grouped it with. */
export function MergeForm({
  problemId,
  targets,
}: {
  problemId: number;
  targets: { value: string; label: string }[];
}) {
  const targetId = useId();
  const [state, action, pending] = useActionState(
    (prev: MergeState, form: FormData) =>
      mergeProblemsAction(problemId, prev, form),
    { status: "idle" } as MergeState,
  );
  return (
    <form action={action} className="space-y-2">
      <Label id={targetId}>Merge this problem into</Label>
      <p className="text-muted-foreground text-sm">
        Its requests and supporters move to the chosen problem, and this one is
        removed.
      </p>
      <Select name="target" items={targets}>
        <SelectTrigger aria-labelledby={targetId} className="w-full max-w-xl">
          <SelectValue placeholder="Choose a problem" />
        </SelectTrigger>
        <SelectContent>
          {targets.map((t) => (
            <SelectItem key={t.value} value={t.value}>
              {t.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        Merge
      </Button>
      {state.status === "invalid" && (
        <p role="alert" className="text-destructive text-sm">
          Choose another problem to merge into.
        </p>
      )}
      {state.status === "decided" && (
        <p role="alert" className="text-destructive text-sm">
          This problem has a decision, so merge the other problem into this one
          instead.
        </p>
      )}
      {state.status === "forbidden" && (
        <p role="alert" className="text-destructive text-sm">
          Only product managers can merge problems.
        </p>
      )}
    </form>
  );
}
