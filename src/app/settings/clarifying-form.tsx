"use client";

import { useActionState } from "react";
import {
  type ClarifyingSettingState,
  setMaxClarifyingQuestionsAction,
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

const idle: ClarifyingSettingState = { status: "idle" };

/** `value` is the current setting; `ceiling` the most a PM may choose. */
export function ClarifyingForm({
  value,
  ceiling,
}: {
  value: number;
  ceiling: number;
}) {
  const [state, action, pending] = useActionState(
    setMaxClarifyingQuestionsAction,
    idle,
  );
  const options = Array.from({ length: ceiling + 1 }, (_, n) => ({
    value: String(n),
    label: n === 0 ? "None (off)" : String(n),
  }));
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <div className="space-y-2">
        <Label id="clarifying-label">Clarifying questions per request</Label>
        <Select name="max" items={options} defaultValue={String(value)}>
          <SelectTrigger aria-labelledby="clarifying-label" className="w-40">
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
