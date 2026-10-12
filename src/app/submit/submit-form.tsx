"use client";

import { useActionState } from "react";
import { type SubmitState, submitRequestAction } from "@/app/actions";
import { SubmitResultMessage } from "@/components/submit-result";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const idle: SubmitState = { status: "idle" };

export function SubmitForm() {
  const [state, action, pending] = useActionState(submitRequestAction, idle);
  const errors = state.status === "invalid" ? state.errors : {};

  return (
    <form action={action} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="title">Title</Label>
        <Input
          id="title"
          name="title"
          defaultValue={state.fields?.title}
          maxLength={200}
          aria-invalid={!!errors.title}
          required
        />
        {errors.title && (
          <p className="text-destructive text-sm">{errors.title[0]}</p>
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor="description">What do you need, and why?</Label>
        <Textarea
          id="description"
          name="description"
          rows={6}
          defaultValue={state.fields?.description}
          maxLength={5000}
          aria-invalid={!!errors.description}
          required
        />
        {errors.description && (
          <p className="text-destructive text-sm">{errors.description[0]}</p>
        )}
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Analyzing…" : "Submit request"}
      </Button>
      <SubmitResultMessage state={state} />
    </form>
  );
}
