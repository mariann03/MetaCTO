import { Suspense } from "react";
import { z } from "zod";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { computeMetrics, type Duration, type Rate } from "@/domain/metrics";
import { deps } from "@/server/deps";
import { getSession } from "@/server/session";
import latestEval from "../../../data/eval/latest.json";

const percent = (v: number | null) =>
  v === null ? "–" : `${Math.round(v * 100)}%`;
const duration = (minutes: number | null) => {
  if (minutes === null) return "–";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  if (minutes < 48 * 60) return `${(minutes / 60).toFixed(1)} h`;
  return `${(minutes / 60 / 24).toFixed(1)} days`;
};

// What the page reads from the eval's results; newer runs also carry the model time.
const tier = z.object({ count: z.number(), precision: z.number().nullable() });
const split = z.object({
  high: tier,
  medium: tier,
  attachRecall: z.number().nullable(),
  newRecall: z.number().nullable(),
});
const evalSchema = z.object({
  runAt: z.string(),
  embeddingModel: z.string(),
  intakeModel: z.string(),
  analyzed: z.number(),
  requests: z.number(),
  retrievalRecall: z.number().nullable(),
  latency: z.object({ medianMs: z.number(), p90Ms: z.number() }).optional(),
  modes: z.object({ hybrid: z.object({ train: split, holdout: split }) }),
});

export default function MetricsPage() {
  return (
    <section className="space-y-6">
      <h1 className="font-semibold text-2xl">Metrics</h1>
      <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
        <Metrics />
      </Suspense>
    </section>
  );
}

function RateCard({
  title,
  description,
  value,
  unit,
}: {
  title: string;
  description: string;
  value: Rate;
  unit: string;
}) {
  return (
    <Card aria-label={title}>
      <CardHeader>
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-3xl tabular-nums">
          {percent(value.rate)}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 text-muted-foreground text-sm">
        <p className="tabular-nums">
          {value.count} of {value.of} {unit}
        </p>
        <p>{description}</p>
      </CardContent>
    </Card>
  );
}

function DurationCard({
  title,
  description,
  value,
  unit,
}: {
  title: string;
  description: string;
  value: Duration;
  unit: string;
}) {
  return (
    <Card aria-label={title}>
      <CardHeader>
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-3xl tabular-nums">
          {duration(value.medianMinutes)}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 text-muted-foreground text-sm">
        <p className="tabular-nums">
          Median over {value.count} {unit}
        </p>
        <p>{description}</p>
      </CardContent>
    </Card>
  );
}

async function Metrics() {
  const { current } = await getSession();
  if (current?.role !== "pm")
    return (
      <p className="text-muted-foreground">
        Only product managers can see metrics.
      </p>
    );
  const m = await computeMetrics(deps);
  const offline = evalSchema.parse(latestEval);
  const holdout = offline.modes.hybrid.holdout;

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="font-semibold text-lg">Fewer duplicates</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <RateCard
            title="Deflection rate"
            description="Needs met with a +1 on the submit page instead of a new request."
            value={m.deflection}
            unit="needs"
          />
          <RateCard
            title="Missed-duplicate rate"
            description="Problems the AI created that a PM later merged into another."
            value={m.missedDuplicates}
            unit="AI-created problems"
          />
        </div>
      </section>
      <section className="space-y-3">
        <h2 className="font-semibold text-lg">Less triage effort</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <RateCard
            title="Hands-off rate"
            description="Confident AI groupings no PM had to touch."
            value={m.handsOff}
            unit="high-confidence groupings"
          />
          <DurationCard
            title="Time to triaged"
            description="From submission to a confident AI grouping or a PM's review."
            value={m.timeToTriaged}
            unit="triaged requests"
          />
        </div>
      </section>
      <section className="space-y-3">
        <h2 className="font-semibold text-lg">Faster stakeholder response</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <DurationCard
            title="Time to first update"
            description="From a problem's first request to its supporters' first status update."
            value={m.timeToFirstUpdate}
            unit="problems with an update"
          />
        </div>
      </section>
      <section className="space-y-3">
        <h2 className="font-semibold text-lg">Guardrail: PM overrides</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <RateCard
            title="Grouping override rate"
            description="AI groupings a PM moved or split."
            value={m.overrides.groupings}
            unit="AI grouping decisions"
          />
          <RateCard
            title="Score override rate"
            description="AI scores a PM overrode."
            value={m.overrides.scores}
            unit="AI scores"
          />
        </div>
      </section>
      <section aria-label="Latest evaluation" className="space-y-3">
        <h2 className="font-semibold text-lg">
          Latest evaluation (offline baseline)
        </h2>
        <p className="text-muted-foreground text-sm">
          Held-out labeled requests, hybrid matching. Intake{" "}
          {offline.intakeModel}, embeddings {offline.embeddingModel};{" "}
          {offline.analyzed} of {offline.requests} requests analyzed on{" "}
          {offline.runAt.slice(0, 10)}.
        </p>
        <dl className="grid gap-4 sm:grid-cols-3">
          {[
            ["Grouped correctly", percent(holdout.attachRecall)],
            ["Review precision", percent(holdout.medium.precision)],
            ["New needs kept new", percent(holdout.newRecall)],
            [
              "Right problem among candidates",
              percent(offline.retrievalRecall),
            ],
            [
              "Auto-grouped",
              `${holdout.high.count} at ${percent(holdout.high.precision)} precision`,
            ],
            [
              "Model time per request",
              offline.latency
                ? `${(offline.latency.medianMs / 1000).toFixed(1)} s median, ${(offline.latency.p90Ms / 1000).toFixed(1)} s p90`
                : "–",
            ],
          ].map(([label, value]) => (
            <div key={label} className="rounded-md border p-4">
              <dt className="text-muted-foreground text-sm">{label}</dt>
              <dd className="font-medium text-xl tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
