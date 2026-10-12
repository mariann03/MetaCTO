"use client";

import { useActionState, useRef, useState } from "react";
import {
  findMatchesAction,
  type Match,
  type SubmitState,
  submitRequestAction,
} from "@/app/actions";
import { SubmitResultMessage } from "@/components/submit-result";
import { SupportButton } from "@/components/support-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supportersLabel } from "@/lib/utils";

const idle: SubmitState = { status: "idle" };
// Live matching starts once title + description are this long, after a typing pause.
const MATCH_MIN_CHARS = 30;
const MATCH_DEBOUNCE_MS = 500;

function formText(form: HTMLFormElement) {
  const data = new FormData(form);
  return {
    title: String(data.get("title") ?? ""),
    description: String(data.get("description") ?? ""),
  };
}

/**
 * Two steps: write (matching Problems appear as you type), then Next shows the matches
 * and the submit button. A +1 on a match supports it instead of filing a duplicate.
 */
export function SubmitForm() {
  const [state, action, pending] = useActionState(submitRequestAction, idle);
  const errors = state.status === "invalid" ? state.errors : {};
  const [matches, setMatches] = useState<Match[] | null>(null);
  // The state Next was pressed in; a new result (a submitted request) starts over.
  const [nextIn, setNextIn] = useState<SubmitState | null>(null);
  const reviewing =
    nextIn === state ||
    state.status === "invalid" ||
    state.status === "rate_limited";
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latest = useRef(0);

  async function match(form: HTMLFormElement) {
    clearTimeout(timer.current);
    const call = ++latest.current;
    const { title, description } = formText(form);
    // Matching is a hint: when it fails, the user can still submit.
    const found = await findMatchesAction(title, description).catch(() => []);
    if (call === latest.current) setMatches(found);
  }

  return (
    <div className="space-y-4">
      <form
        action={action}
        className="space-y-4"
        onChange={(e) => {
          const form = e.currentTarget;
          const { title, description } = formText(form);
          clearTimeout(timer.current);
          if (`${title}${description}`.trim().length >= MATCH_MIN_CHARS)
            timer.current = setTimeout(() => match(form), MATCH_DEBOUNCE_MS);
        }}
        onReset={() => setMatches(null)}
      >
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
        {/* Keyed apart: reusing the Next button as the submit button would submit on Next. */}
        {reviewing ? (
          <Button key="submit" type="submit" disabled={pending}>
            {pending ? "Analyzing…" : "Submit request"}
          </Button>
        ) : (
          <Button
            key="next"
            type="button"
            onClick={(e) => {
              const { form } = e.currentTarget;
              if (form) void match(form);
              setNextIn(state);
            }}
          >
            Next
          </Button>
        )}
      </form>
      {/* Outside the form: each match and the result hold forms of their own. */}
      {matches && matches.length > 0 && (
        <section aria-label="Similar problems" className="space-y-2">
          <h2 className="font-medium">Is this what you're asking for?</h2>
          <ul className="divide-y rounded-md border">
            {matches.map((m) => (
              <li key={m.id} aria-label={m.statement} className="space-y-2 p-3">
                <p>{m.statement}</p>
                <p className="text-muted-foreground text-sm">
                  {supportersLabel(m.supporters)}
                </p>
                <SupportButton
                  problemId={m.id}
                  source="submit"
                  supported={m.supported}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
      <SubmitResultMessage state={state} />
    </div>
  );
}
