import { cosineSimilarity, embed } from "ai";
import type { Models } from "@/ai/models";
import {
  ANALYSIS_ATTEMPTS,
  analyzeRequest,
  embeddingText,
  PROVISIONAL_THRESHOLDS,
  placeRequest,
  type Thresholds,
  type Tier,
} from "./intake";
import type { MatchMode } from "./settings";

/**
 * One fixture request replayed against the ground-truth state: the Problems that the
 * requests before it should have formed. Clusters are ground-truth keys (the problem key,
 * or the request's own key for a one-off), so scoring needs no database.
 */
export interface Observation {
  key: string;
  split: "train" | "holdout";
  /** The cluster this request truly belongs to. */
  truth: string;
  /** Whether that cluster already existed, i.e. the request should have been grouped. */
  truthExisted: boolean;
  /** Closest clusters, most similar first, as intake would have offered them. */
  candidates: { cluster: string; similarity: number }[];
  /** The model's verdict in hybrid mode; null when it was not asked (no candidates). */
  verdict: {
    verdict: "same_problem" | "related_but_different" | "different";
    cluster: string | null;
  } | null;
}

export interface TierStats {
  count: number;
  correct: number;
  /** correct / count; null when the tier is empty. */
  precision: number | null;
}

export interface Metrics {
  requests: number;
  /** Requests whose Problem already existed, so grouping them was the right call. */
  attachable: number;
  /** high/medium are right when grouped into the true Problem; low when it was truly new. */
  high: TierStats;
  medium: TierStats;
  low: TierStats;
  /** Share of attachable requests auto-grouped correctly. */
  highRecall: number | null;
  /** Share of attachable requests grouped correctly at high or medium. */
  attachRecall: number | null;
}

/** Where intake would place each observation at these thresholds, and whether that was right. */
function decisions(
  observations: Observation[],
  mode: MatchMode,
  thresholds: Thresholds,
) {
  return observations.map((o) => {
    // placeRequest works on numeric Problem ids; the candidate index stands in for one.
    const candidates = o.candidates.map((c, i) => ({
      problemId: i,
      similarity: c.similarity,
    }));
    const named = o.candidates.findIndex(
      (c) => c.cluster === o.verdict?.cluster,
    );
    const match =
      mode === "hybrid" && o.verdict
        ? {
            verdict: o.verdict.verdict,
            problemId: named === -1 ? null : named,
            rationale: "",
          }
        : null;
    const { tier, candidate } = placeRequest({ candidates, match, thresholds });
    const cluster =
      candidate === null ? null : o.candidates[candidate.problemId]?.cluster;
    const correct = tier === "low" ? !o.truthExisted : cluster === o.truth;
    return { tier, correct, attachable: o.truthExisted };
  });
}

const ratio = (part: number, whole: number) =>
  whole === 0 ? null : part / whole;

/** Precision per tier and recall of grouping, for these observations at these thresholds. */
export function score(
  observations: Observation[],
  mode: MatchMode,
  thresholds: Thresholds,
): Metrics {
  const placed = decisions(observations, mode, thresholds);
  const stats = (tier: Tier): TierStats => {
    const inTier = placed.filter((d) => d.tier === tier);
    const correct = inTier.filter((d) => d.correct).length;
    return {
      count: inTier.length,
      correct,
      precision: ratio(correct, inTier.length),
    };
  };
  const high = stats("high");
  const medium = stats("medium");
  const attachable = placed.filter((d) => d.attachable).length;
  return {
    requests: placed.length,
    attachable,
    high,
    medium,
    low: stats("low"),
    highRecall: ratio(high.correct, attachable),
    attachRecall: ratio(high.correct + medium.correct, attachable),
  };
}

/**
 * Of the requests that should be grouped, the share whose Problem was offered as a candidate:
 * what similarity search makes possible before the model or thresholds decide.
 */
export function retrievalRecall(observations: Observation[]) {
  const attachable = observations.filter((o) => o.truthExisted);
  const found = attachable.filter((o) =>
    o.candidates.some((c) => c.cluster === o.truth),
  ).length;
  return ratio(found, attachable.length);
}

/** Auto-grouping must be right at least this often; below it, a PM reviews instead. */
export const HIGH_TIER_PRECISION_TARGET = 0.95;
/** Above any similarity: the threshold that means "never auto-group". */
const NEVER = 1.01;
const GRID = Array.from(
  { length: 70 },
  (_, i) => Math.round((0.3 + i * 0.01) * 100) / 100,
);

/**
 * Lower bound of the 95% Wilson score interval for `correct` out of `count`:
 * the precision we can be confident of, which is low when there are few cases.
 */
export function confidentPrecision(correct: number, count: number) {
  if (count === 0) return 0;
  const z = 1.96;
  const p = correct / count;
  const z2 = z * z;
  return (
    (p +
      z2 / (2 * count) -
      z * Math.sqrt((p * (1 - p) + z2 / (4 * count)) / count)) /
    (1 + z2 / count)
  );
}

/**
 * Tunes thresholds on the train split.
 * high: the lowest value whose auto-grouping is confidently (Wilson lower bound) at least
 * 95% precise. Without that much evidence the provisional value stays, unless what was
 * observed at it is below target, in which case nothing auto-groups.
 * low (similarity-only; hybrid reviews by verdict): where grouping at high or medium has the best F1.
 */
export function tune(observations: Observation[], mode: MatchMode): Thresholds {
  const train = observations.filter((o) => o.split === "train");
  const highAt = (h: number) => score(train, mode, { low: h, high: h }).high;
  const provisional = PROVISIONAL_THRESHOLDS[mode].high;
  const observedAtProvisional = highAt(provisional).precision;
  const high =
    GRID.find((h) => {
      const { correct, count } = highAt(h);
      return confidentPrecision(correct, count) >= HIGH_TIER_PRECISION_TARGET;
    }) ??
    (observedAtProvisional === null ||
    observedAtProvisional >= HIGH_TIER_PRECISION_TARGET
      ? provisional
      : NEVER);
  if (mode === "hybrid")
    return { low: Math.min(high, PROVISIONAL_THRESHOLDS.hybrid.low), high };

  let best = { low: high, f1: -1 };
  for (const low of GRID.filter((l) => l <= high)) {
    const m = score(train, mode, { low, high });
    const correct = m.high.correct + m.medium.correct;
    const precision = ratio(correct, m.high.count + m.medium.count) ?? 0;
    const recall = m.attachRecall ?? 0;
    const f1 =
      precision + recall === 0
        ? 0
        : (2 * precision * recall) / (precision + recall);
    // >= keeps the highest low among ties: fewer reviews for the same accuracy.
    if (f1 >= best.f1) best = { low, f1 };
  }
  return { low: best.low, high };
}

/** A labeled fixture request, in submission order. */
export interface EvalRequest {
  key: string;
  /** Ground truth: the problem it belongs to, or null for a one-off. */
  problemKey: string | null;
  split: "train" | "holdout";
  title: string;
  description: string;
}

const CANDIDATE_COUNT = 3;

/**
 * Replays each request through the real intake call against the ground-truth state:
 * the Problems the earlier requests should have formed, each stated as intake stated its
 * first request. Requests whose analysis fails every attempt are left out.
 */
export async function collectObservations(
  models: Pick<Models, "intake" | "embedding">,
  requests: EvalRequest[],
  onProgress: (done: number, total: number) => void = () => {},
): Promise<Observation[]> {
  const clusters = new Map<
    string,
    { id: number; statement: string; vectors: number[][] }
  >();
  const observations: Observation[] = [];

  for (const [index, request] of requests.entries()) {
    const { embedding } = await embed({
      model: models.embedding,
      value: embeddingText(request),
    });
    const ranked = [...clusters]
      .map(([cluster, { id, statement, vectors }]) => ({
        cluster,
        id,
        statement,
        similarity: Math.max(
          ...vectors.map((v) => cosineSimilarity(embedding, v)),
        ),
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, CANDIDATE_COUNT);

    let analysis: Awaited<ReturnType<typeof analyzeRequest>> | undefined;
    for (let attempt = 1; attempt <= ANALYSIS_ATTEMPTS && !analysis; attempt++)
      analysis = await analyzeRequest(models, {
        request,
        mode: "hybrid",
        candidates: ranked.map((c) => ({
          problemId: c.id,
          similarity: c.similarity,
          statement: c.statement,
        })),
      }).catch(() => undefined);

    const truth = request.problemKey ?? request.key;
    const existing = clusters.get(truth);
    if (analysis) {
      const { match } = analysis;
      const named = ranked.find((c) => c.id === match?.problemId)?.cluster;
      observations.push({
        key: request.key,
        split: request.split,
        truth,
        truthExisted: existing !== undefined,
        candidates: ranked.map(({ cluster, similarity }) => ({
          cluster,
          similarity,
        })),
        verdict: match && { verdict: match.verdict, cluster: named ?? null },
      });
    }
    // The state after this request, as it should be: it joins its true cluster.
    if (existing) existing.vectors.push(embedding);
    else
      clusters.set(truth, {
        id: clusters.size + 1,
        statement:
          analysis?.extraction.problemStatement ??
          `${request.title}. ${request.description}`,
        vectors: [embedding],
      });
    onProgress(index + 1, requests.length);
  }
  return observations;
}
