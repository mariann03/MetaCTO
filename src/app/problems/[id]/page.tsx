import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { ProblemStatusBadge } from "@/components/problem-status";
import { ScoreValue } from "@/components/score-value";
import { OverrideForm, RescoreButton } from "@/components/scoring-controls";
import { SupportButton } from "@/components/support-button";
import { getProblem } from "@/domain/problems";
import { JUDGED } from "@/domain/ranking";
import { getScores } from "@/domain/scoring";
import { JUDGED_LABELS, type Segment } from "@/lib/labels";
import { plural } from "@/lib/utils";
import { deps } from "@/server/deps";
import { getSession } from "@/server/session";

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

      <section className="space-y-2">
        <h2 className="font-semibold text-lg">Decision</h2>
        {/* Filled in once PMs record decisions with a public rationale. */}
        <p className="text-muted-foreground">No public rationale yet.</p>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold text-lg">Updates</h2>
        {/* Filled in once approved updates are delivered to supporters. */}
        <p className="text-muted-foreground">No updates yet.</p>
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
