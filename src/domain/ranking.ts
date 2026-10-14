// Pure: the ranking page runs it in the browser, so the order follows the sliders at once.
import type { ProblemCriteria } from "./prioritization";

/** The criteria the AI judges per Problem, 1 to 5; the rest are computed in SQL. */
export const JUDGED = ["strategicFit", "urgency", "effort"] as const;
export type Judged = (typeof JUDGED)[number];

export const CRITERIA = [
  "reach",
  "businessValue",
  "strategicFit",
  "urgency",
  "effort",
] as const;
export type Criterion = (typeof CRITERIA)[number];
export type Weights = Record<Criterion, number>;

// ARR of accounts at risk of churning counts twice. Segment mix is shown, not scored: ARR already follows it.
const value = (p: ProblemCriteria) => p.arr + p.churnRiskArr;
// AI scores run 1 to 5; one never scored counts as the middle, neither helping nor hurting.
const judged = (score: { value: number } | null) =>
  score ? (score.value - 1) / 4 : 0.5;

/**
 * Scores each criterion from 0 to 1 (Reach and Business value against the top Problem on
 * it, AI scores on their own scale, using the PM's override where there is one), then orders by the
 * weighted average of those scores; ties keep the oldest Problem first. Computed in code,
 * so it never waits on a model.
 */
export function rank(problems: ProblemCriteria[], weights: Weights) {
  // ponytail: linear against the top Problem, so one huge account flattens the rest; log-scale ARR if that hides real differences.
  const top = (of: (p: ProblemCriteria) => number) =>
    Math.max(0, ...problems.map(of)) || 1;
  const most = {
    supporters: top((p) => p.supporters),
    accounts: top((p) => p.accounts),
    value: top(value),
  };
  const totalWeight = CRITERIA.reduce((sum, c) => sum + weights[c], 0);

  return problems
    .map((p) => {
      const scores: Weights = {
        // Supporters and accounts in equal parts.
        reach:
          (p.supporters / most.supporters + p.accounts / most.accounts) / 2,
        businessValue: value(p) / most.value,
        strategicFit: judged(p.judged.strategicFit),
        urgency: judged(p.judged.urgency),
        // Less effort ranks higher.
        effort: 1 - judged(p.judged.effort),
      };
      const weighted = CRITERIA.reduce(
        (sum, c) => sum + weights[c] * scores[c],
        0,
      );
      const score = totalWeight === 0 ? 0 : weighted / totalWeight;
      return { ...p, scores, score };
    })
    .sort((a, b) => b.score - a.score || a.id - b.id);
}
