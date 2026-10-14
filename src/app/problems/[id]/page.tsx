import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import {
  DecisionForm,
  DraftForm,
  DraftUpdatesButton,
} from "@/components/decision-controls";
import { ProblemStatusBadge } from "@/components/problem-status";
import { ScoreValue } from "@/components/score-value";
import { OverrideForm, RescoreButton } from "@/components/scoring-controls";
import { SupportButton } from "@/components/support-button";
import {
  DECISIONS,
  latestDecision,
  listDrafts,
  listInternalUpdates,
} from "@/domain/decisions";
import { getProblem } from "@/domain/problems";
import { JUDGED } from "@/domain/ranking";
import { getScores } from "@/domain/scoring";
import { JUDGED_LABELS, type Segment, STATUS_LABELS } from "@/lib/labels";
import { plural } from "@/lib/utils";
import { deps } from "@/server/deps";
import { getSession } from "@/server/session";

const dateFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });
const DECISION_OPTIONS = DECISIONS.map((value) => ({
  value,
  label: STATUS_LABELS[value],
}));
const AUDIENCE = {
  customer: "Customer update (to every supporter)",
  internal: "Internal update (Sales and Customer Success)",
} as const;

// Requests are anonymized: who asked is shown only as their customer segment.
const ASKED_BY: Record<Segment, string> = {
  smb: "An SMB customer",
  mid_market: "A Mid-market customer",
  enterprise: "An Enterprise customer",
};

export default function ProblemPage({ params }: PageProps<"/problems/[id]">) {
  return (
    <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
      <ProblemDetail params={params} />
    </Suspense>
  );
}

async function ProblemDetail({
  params,
}: Pick<PageProps<"/problems/[id]">, "params">) {
  const id = z.coerce
    .number()
    .int()
    .positive()
    .safeParse((await params).id);
  if (!id.success) notFound();
  const { current } = await getSession();
  if (!current) return null;
  const problem = await getProblem(deps, current.id, id.data);
  if (!problem) notFound();

  return (
    <article className="space-y-8">
      <header className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          <h1 className="font-semibold text-2xl">{problem.statement}</h1>
          <ProblemStatusBadge status={problem.status} />
        </div>
        <p className="text-muted-foreground text-sm">
          {plural(problem.supporters, "supporter")}
        </p>
        <SupportButton
          problemId={problem.id}
          source="explore"
          supported={problem.supported}
        />
      </header>

      {current.role === "pm" && <Scores problemId={problem.id} />}

      <section aria-label="Decision" className="space-y-2">
        <h2 className="font-semibold text-lg">Decision</h2>
        {problem.decision ? (
          <p>
            <span className="font-medium">
              {STATUS_LABELS[problem.decision.status]}:
            </span>{" "}
            {problem.decision.rationale}
          </p>
        ) : (
          <p className="text-muted-foreground">No public rationale yet.</p>
        )}
      </section>

      {current.role === "pm" && <Communication problemId={problem.id} />}

      <section aria-label="Updates" className="space-y-2">
        <h2 className="font-semibold text-lg">Updates</h2>
        {problem.updates.length === 0 ? (
          <p className="text-muted-foreground">No updates yet.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {problem.updates.map((update) => (
              <li key={update.id} className="space-y-1 p-4">
                <p className="whitespace-pre-line">{update.body}</p>
                {update.approvedAt && (
                  <p className="text-muted-foreground text-xs">
                    {dateFormat.format(update.approvedAt)}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold text-lg">Requests</h2>
        <ul className="divide-y rounded-md border">
          {problem.requests.map((request) => (
            <li
              key={request.id}
              id={`request-${request.id}`}
              className="space-y-1 p-4"
            >
              <p className="text-muted-foreground text-sm">
                {request.segment ? ASKED_BY[request.segment] : "A customer"}
              </p>
              <p className="font-medium">{request.title}</p>
              <p className="whitespace-pre-line">{request.description}</p>
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}

/** PM only: the AI's scores with rationale and cited requests, rescore and override. */
async function Scores({ problemId }: { problemId: number }) {
  const judged = await getScores(deps, problemId);
  return (
    <section aria-label="Scores" className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <h2 className="font-semibold text-lg">Scores</h2>
        <RescoreButton problemId={problemId} />
      </div>
      <ul className="divide-y rounded-md border">
        {JUDGED.map((criterion) => {
          const score = judged[criterion];
          return (
            <li
              key={criterion}
              aria-label={JUDGED_LABELS[criterion]}
              className="space-y-2 p-4"
            >
              <div className="flex items-center justify-between gap-4">
                <span className="font-medium">{JUDGED_LABELS[criterion]}</span>
                <ScoreValue score={score} />
              </div>
              {score && (
                <>
                  <p className="text-sm">
                    AI: {score.rationale}{" "}
                    {score.citedRequestIds.map((id) => (
                      <a
                        key={id}
                        href={`#request-${id}`}
                        className="mr-1 text-muted-foreground underline"
                      >
                        #{id}
                      </a>
                    ))}
                  </p>
                  {score.override && (
                    <p className="text-sm">
                      Overridden to {score.override.value}/5:{" "}
                      {score.override.reason}
                    </p>
                  )}
                  <OverrideForm
                    problemId={problemId}
                    criterion={criterion}
                    name={JUDGED_LABELS[criterion]}
                  />
                </>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** PM only: record a decision, then edit and approve the two drafted updates. */
async function Communication({ problemId }: { problemId: number }) {
  const [drafts, internal, latest] = await Promise.all([
    listDrafts(deps, problemId),
    listInternalUpdates(deps, problemId),
    latestDecision(deps.db, problemId),
  ]);
  // Drafting failed, or was never finished: some audience has neither a draft nor its update.
  const undrafted =
    latest !== null && drafts.length === 0 && latest.approved.length < 2;
  return (
    <section aria-label="Decide and update" className="space-y-4">
      <h2 className="font-semibold text-lg">Decide and update</h2>
      <DecisionForm problemId={problemId} options={DECISION_OPTIONS} />
      {drafts.length > 0 && (
        <div className="divide-y rounded-md border">
          {drafts.map((d) => (
            <DraftForm
              key={d.id}
              updateId={d.id}
              problemId={problemId}
              title={AUDIENCE[d.audience]}
              body={d.body}
            />
          ))}
        </div>
      )}
      {undrafted && <DraftUpdatesButton problemId={problemId} />}
      {internal.length > 0 && (
        <div className="space-y-2">
          <h3 className="font-medium">Approved internal updates</h3>
          <ul className="divide-y rounded-md border">
            {internal.map((u) => (
              <li key={u.id} className="whitespace-pre-line p-4">
                {u.body}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
