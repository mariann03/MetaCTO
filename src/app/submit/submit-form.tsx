"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  askQuestionsAction,
  findMatchesAction,
  type Match,
  type SubmitState,
  submitRequestAction,
} from "@/app/actions";
import { ProblemItem } from "@/components/problem-item";
import { SubmitResultMessage } from "@/components/submit-result";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Clarification } from "@/domain/intake";

const idle: SubmitState = { status: "idle" };
// Live matching waits for enough text to match on and for a pause, so it does not embed every keystroke.
const MATCH_MIN_CHARS = 30;
const MATCH_DEBOUNCE_MS = 500;

/**
 * Two steps: write (matching Problems appear as you type), then Next shows the matches,
 * any clarifying questions and the submit button. A +1 on a match supports it instead of
 * filing a duplicate; every question can be skipped.
 */
export function SubmitForm() {
  const [state, action, pending] = useActionState(submitRequestAction, idle);
  const [deflectedTo, setDeflectedTo] = useState<string | null>(null);

  if (deflectedTo)
    return (
      <div className="space-y-3">
        <p role="status" className="rounded-md border bg-muted p-3 text-sm">
          Your support was added to: <strong>{deflectedTo}</strong>. No need to
          submit a request.
        </p>
        <Button variant="outline" onClick={() => setDeflectedTo(null)}>
          Write a different request
        </Button>
      </div>
    );

  return (
    <div className="space-y-4">
      {/* A finished submission starts a new round: its matches, step and timers reset. */}
      <RequestForm
        key={"requestId" in state ? state.requestId : "open"}
        state={state}
        action={action}
        pending={pending}
        onDeflected={setDeflectedTo}
      />
      <SubmitResultMessage state={state} />
    </div>
  );
}

function formText(form: HTMLFormElement) {
  const data = new FormData(form);
  return {
    title: String(data.get("title") ?? ""),
    description: String(data.get("description") ?? ""),
  };
}

function RequestForm({
  state,
  action,
  pending,
  onDeflected,
}: {
  state: SubmitState;
  action: (form: FormData) => void;
  pending: boolean;
  onDeflected: (statement: string) => void;
}) {
  const errors = state.status === "invalid" ? state.errors : {};
  // A refused submission keeps its text, so it stays on the confirm step.
  const [step, setStep] = useState<"write" | "confirm">(
    state.status === "invalid" || state.status === "rate_limited"
      ? "confirm"
      : "write",
  );
  const [matches, setMatches] = useState<Match[] | null>(null);
  // null while the questions are being asked for; a refused submission brings its answers back.
  const [questions, setQuestions] = useState<Clarification[] | null>(
    state.fields?.clarifications ?? [],
  );
  // Bumped when the text changes, so questions about older text never land.
  const asking = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Bumped to discard lookups still in flight: only the latest may show its matches.
  const latest = useRef(0);

  function cancelLookups() {
    clearTimeout(timer.current);
    latest.current++;
  }
  // Leaving the page must not leave a lookup (an embedding call) to fire.
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      latest.current++;
    },
    [],
  );

  async function match(form: HTMLFormElement) {
    cancelLookups();
    const call = latest.current;
    const { title, description } = formText(form);
    // Matching is a hint: when it fails, the user can still submit.
    const found = await findMatchesAction(title, description).catch(() => []);
    if (call === latest.current) setMatches(found);
  }

  return (
    <>
      <form
        action={action}
        className="space-y-4"
        onChange={(e) => {
          // Only the request text matters; typing an answer changes neither.
          const field = (e.target as HTMLElement).getAttribute("name");
          if (field !== "title" && field !== "description") return;
          // Questions were about the old text: back to Next, which asks again.
          if (step === "confirm") {
            asking.current++;
            setQuestions([]);
            setStep("write");
          }
          const form = e.currentTarget;
          const { title, description } = formText(form);
          cancelLookups();
          if (`${title}${description}`.trim().length >= MATCH_MIN_CHARS)
            timer.current = setTimeout(() => match(form), MATCH_DEBOUNCE_MS);
          else setMatches(null);
        }}
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
        {step === "confirm" && questions === null && (
          <p className="text-muted-foreground text-sm">
            Checking whether we need anything else…
          </p>
        )}
        {step === "confirm" &&
          questions?.map(({ question, answer }, i) => (
            // Questions are unique (the domain drops repeats), so the text is a stable key.
            <fieldset
              key={question}
              className="space-y-2 rounded-md border p-3"
            >
              <input type="hidden" name="question" value={question} />
              <Label htmlFor={`answer-${i}`}>{question}</Label>
              <Textarea
                id={`answer-${i}`}
                name="answer"
                rows={2}
                maxLength={2000}
                defaultValue={answer}
                placeholder="Optional: helps us understand what you need"
              />
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() =>
                  setQuestions(
                    (qs) => qs?.filter((q) => q.question !== question) ?? [],
                  )
                }
              >
                Skip this question
              </Button>
            </fieldset>
          ))}
        {/* Keyed apart: reusing the Next button as the submit button would submit on Next. */}
        {step === "confirm" ? (
          <Button
            key="submit"
            type="submit"
            // Waits for the questions, which time out on the server, so they are seen.
            disabled={pending || questions === null}
          >
            {pending ? "Analyzing…" : "Submit request"}
          </Button>
        ) : (
          <Button
            key="next"
            type="button"
            onClick={(e) => {
              const { form } = e.currentTarget;
              if (form) {
                void match(form);
                const { title, description } = formText(form);
                const call = ++asking.current;
                setQuestions(null);
                void askQuestionsAction(title, description)
                  .catch(() => [])
                  .then((asked) => {
                    if (call === asking.current)
                      setQuestions(
                        asked.map((question) => ({ question, answer: "" })),
                      );
                  });
              }
              setStep("confirm");
            }}
          >
            Next
          </Button>
        )}
      </form>
      {/* Outside the form: each match holds a form of its own. */}
      {matches && matches.length > 0 && (
        <section aria-label="Similar problems" className="space-y-2">
          <h2 className="font-medium">Is this what you're asking for?</h2>
          <ul className="divide-y rounded-md border">
            {matches.map((m) => (
              <ProblemItem
                key={m.id}
                problem={m}
                source="submit"
                onSupported={() => onDeflected(m.statement)}
              />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
