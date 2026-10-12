"use client";

import { useActionState } from "react";
import { type MatchModeState, setMatchModeAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { MatchMode } from "@/domain/intake";

const MODES: { value: MatchMode; label: string }[] = [
  { value: "hybrid", label: "Hybrid: similarity and AI verdict" },
  { value: "similarity-only", label: "Similarity only" },
];
const idle: MatchModeState = { status: "idle" };

export function MatchModeForm({ mode }: { mode: MatchMode }) {
  const [state, action, pending] = useActionState(setMatchModeAction, idle);

  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <div className="space-y-2">
        <Label id="mode-label">Matching mode</Label>
        <Select name="mode" items={MODES} defaultValue={mode}>
          <SelectTrigger aria-labelledby="mode-label" className="w-80">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MODES.map((m) => (
              <SelectItem key={m.value} value={m.value}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button type="submit" disabled={pending}>
        Save
      </Button>
      {state.status === "saved" && <p role="status">Saved.</p>}
      {state.status === "forbidden" && (
        <p role="alert">Only product managers can change settings.</p>
      )}
    </form>
  );
}
