import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { BriefButton } from "@/components/brief-button";
import { MergeForm, StatementForm } from "@/components/curation-controls";
import {
  DecisionForm,
  DraftForm,
  DraftUpdatesButton,
} from "@/components/decision-controls";
import { ProblemStatusBadge } from "@/components/problem-status";
import { ScoreValue } from "@/components/score-value";
import { OverrideForm, RescoreButton } from "@/components/scoring-controls";
import { SupportButton } from "@/components/support-button";
import { type Brief, getLatestBrief, lastBriefFailure } from "@/domain/brief";
import { isStatementLocked, listVersions } from "@/domain/curation";
import {
  DECISIONS,
  latestDecision,
  listDrafts,
  listInternalUpdates,
} from "@/domain/decisions";
import { getProblem, listProblems } from "@/domain/problems";
import { JUDGED } from "@/domain/ranking";
import { getScores } from "@/domain/scoring";
import {
  AUTHOR_LABELS,
  JUDGED_LABELS,
  type Segment,
  STATUS_LABELS,
} from "@/lib/labels";
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

// Requests are anonymized: who asked is shown only as their customer segment. Requests by
// our own team (no segment) are shown only to our team.
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

      {current.role === "pm" && (
        <Curation
          problemId={problem.id}
          statement={problem.statement}
          viewerId={current.id}
        />
      )}

      {current.role === "pm" && <Scores problemId={problem.id} />}

      {current.role === "pm" && <DecisionBrief problemId={problem.id} />}

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
                {request.segment ? ASKED_BY[request.segment] : "Our team"}
              </p>
              <p className="font-medium">{request.title}</p>
              <p className="whitespace-pre-line">{request.description}</p>
              {request.clarifications.map((c) => (
                <p key={c.question} className="text-sm">
                  <span className="text-muted-foreground">{c.question}</span>{" "}
                  {c.answer}
                </p>
              ))}
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
    <section id="scores" aria-label="Scores" className="space-y-3">
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

/** PM only: rewrite and lock the statement, see who wrote each version, merge a duplicate. */
async function Curation({
  problemId,
  statement,
  viewerId,
}: {
  problemId: number;
  statement: string;
  viewerId: number;
}) {
  const [locked, versions, all] = await Promise.all([
    isStatementLocked(deps, problemId),
    listVersions(deps, problemId),
    // ponytail: every Problem fills the picker (71 on the seed); search past a few hundred.
    listProblems(deps, { viewerId }),
  ]);
  const targets = all
    .filter((p) => p.id !== problemId)
    .map((p) => ({ value: String(p.id), label: p.statement }));
  return (
    <section aria-label="Curate" className="space-y-4">
      <h2 className="font-semibold text-lg">Curate</h2>
      <StatementForm
        // Remount after each save, so the form shows the stored statement.
        key={`${statement}|${locked}`}
        problemId={problemId}
        statement={statement}
        locked={locked}
      />
      <details>
        <summary className="cursor-pointer text-sm">
          Statement history ({versions.length})
        </summary>
        <ol
          aria-label="Statement history"
          className="mt-2 divide-y rounded-md border"
        >
          {versions.map((v) => (
            <li key={v.id} className="space-y-1 p-3 text-sm">
              <p>{v.statement}</p>
              <p className="text-muted-foreground text-xs">
                {AUTHOR_LABELS[v.author]} · {dateFormat.format(v.createdAt)}
              </p>
            </li>
          ))}
        </ol>
      </details>
      <MergeForm problemId={problemId} targets={targets} />
    </section>
  );
}

/**
 * Where a brief's source id leads: the request below, a Problem, the scores or the strategy.
 * Accounts and +1 notes have no page, so their ids are shown as they are.
 */
function sourceHref(source: string, problemId: number) {
  const [kind, id] = source.split(":");
  if (kind === "request") return `#request-${id}`;
  if (kind === "problem")
    return Number(id) === problemId ? "#" : `/problems/${id}`;
  if (kind === "score") return "#scores";
  if (kind === "strategy") return "/settings";
  return null;
}

function Sources({ ids, problemId }: { ids: string[]; problemId: number }) {
  return (
    <span className="ml-1 inline-flex flex-wrap gap-1 align-baseline">
      {ids.map((id) => {
        const href = sourceHref(id, problemId);
        return href ? (
          <a
            key={id}
            href={href}
            className="text-muted-foreground text-xs underline"
          >
            {id}
          </a>
        ) : (
          <span key={id} className="text-muted-foreground text-xs">
            {id}
          </span>
        );
      })}
    </span>
  );
}

const BRIEF_SECTIONS = [
  ["whoIsAsking", "Who is asking"],
  ["scores", "Scores"],
  ["options", "Solution options"],
  ["risks", "Open questions and risks"],
] as const satisfies [keyof Brief, string][];

/** PM only: the agent's latest brief, every claim linked to its sources. */
async function DecisionBrief({ problemId }: { problemId: number }) {
  const [latest, failedAt] = await Promise.all([
    getLatestBrief(deps, problemId),
    lastBriefFailure(deps, problemId),
  ]);
  const brief = latest?.content;
  return (
    <section aria-label="Decision brief" className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <h2 className="font-semibold text-lg">Decision brief</h2>
        <BriefButton problemId={problemId} again={brief !== undefined} />
      </div>
      {failedAt && (
        <p role="alert" className="text-sm">
          The last attempt, on {dateFormat.format(failedAt)}, did not produce a
          brief that cites its sources. Generate it again.
        </p>
      )}
      {latest && brief ? (
        <div className="space-y-4 rounded-md border p-4 text-sm">
          <p className="text-muted-foreground text-xs">
            Drafted by AI on {dateFormat.format(latest.createdAt)}; check its
            sources before relying on it.
          </p>
          <p>
            {brief.statement.text}
            <Sources ids={brief.statement.sources} problemId={problemId} />
          </p>
          {brief.quotes.length > 0 && (
            <div className="space-y-1">
              <h3 className="font-medium">Representative quotes</h3>
              {brief.quotes.map((q, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: model text may repeat; the order is fixed
                <blockquote key={i} className="border-l-2 pl-3">
                  “{q.quote}”
                  <Sources ids={[q.source]} problemId={problemId} />
                </blockquote>
              ))}
            </div>
          )}
          {BRIEF_SECTIONS.map(([key, title]) => (
            <div key={key} className="space-y-1">
              <h3 className="font-medium">{title}</h3>
              <ul className="list-disc space-y-1 pl-5">
                {brief[key].map((c, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: model text may repeat; the order is fixed
                  <li key={i}>
                    {c.text}
                    <Sources ids={c.sources} problemId={problemId} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground">No brief yet.</p>
      )}
    </section>
  );
}
