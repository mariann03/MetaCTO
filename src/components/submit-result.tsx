import Link from "next/link";
import type { SubmitState } from "@/app/actions";
import { SplitButton } from "./split-button";

/** Tells the submitter what happened to their request. */
export function SubmitResultMessage({ state }: { state: SubmitState }) {
  switch (state.status) {
    case "submitted":
      return state.tier === "low" ? (
        <p role="status" className="rounded-md border bg-muted p-3 text-sm">
          New problem created: <strong>{state.statement}</strong>
        </p>
      ) : (
        <div
          role="status"
          className="space-y-2 rounded-md border bg-muted p-3 text-sm"
        >
          <p>
            Grouped into: <strong>{state.statement}</strong>
          </p>
          {/* Keyed so a later grouped submission gets a fresh button, not the last one's "Thanks". */}
          <SplitButton key={state.requestId} requestId={state.requestId} />
        </div>
      );
    case "draft":
      return (
        <p
          role="alert"
          className="rounded-md border border-destructive p-3 text-sm"
        >
          We couldn't analyze your request right now. It's saved as a draft in{" "}
          <Link href="/my-requests" className="underline">
            My requests
          </Link>
          ; please try again later.
        </p>
      );
    case "analyzing":
      return (
        <p role="status" className="rounded-md border bg-muted p-3 text-sm">
          This request is already being analyzed. Check back in a moment.
        </p>
      );
    case "rate_limited":
      return (
        <p
          role="alert"
          className="rounded-md border border-destructive p-3 text-sm"
        >
          You've reached the limit of requests per hour. Please try again later.
        </p>
      );
    default:
      return null;
  }
}
