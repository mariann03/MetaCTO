"use client";

import { useActionState, useId, useState } from "react";
import { addSupportAction, type SupportState } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { SupportSource } from "@/domain/problems";

const idle: SupportState = { status: "idle" };

/** "+1, this affects me", then an optional note on how, kept as evidence. */
export function SupportButton({
  problemId,
  source,
  supported,
}: {
  problemId: number;
  source: SupportSource;
  supported: boolean;
}) {
  const noteId = useId();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(
    addSupportAction.bind(null, problemId, source),
    idle,
  );

  if (state.status === "added")
    return (
      <p role="status" className="text-sm">
        Thanks, your support was added.
      </p>
    );
  if (state.status === "missing")
    return (
      <p role="alert" className="text-sm">
        This problem no longer exists.
      </p>
    );
  if (supported || state.status === "already_supported")
    return (
      <p className="text-muted-foreground text-sm">You support this problem.</p>
    );
  if (!open)
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        +1, this affects me
      </Button>
    );
  return (
    <form action={action} className="space-y-2">
      <Label htmlFor={noteId}>How does this affect you? (optional)</Label>
      <Textarea id={noteId} name="note" rows={2} maxLength={1000} />
      <Button type="submit" size="sm" disabled={pending}>
        Add my support
      </Button>
    </form>
  );
}
