// Pure: the ranking page runs it in the browser, so the order follows the sliders at once.
import type { ProblemCriteria } from "./prioritization";

export const CRITERIA = ["reach", "businessValue"] as const;
export type Criterion = (typeof CRITERIA)[number];
export type Weights = Record<Criterion, number>;

// ARR of accounts at risk of churning counts twice. Segment mix is shown, not scored: ARR already follows it.
const value = (p: ProblemCriteria) => p.arr + p.churnRiskArr;

/**
 * Scores each criterion from 0 to 1 against the top Problem on it, then orders by the
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
