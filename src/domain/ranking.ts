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
  const topSupporters = top((p) => p.supporters);
  const topAccounts = top((p) => p.accounts);
  const topValue = top(value);
  const totalWeight = weights.reach + weights.businessValue;

  return problems
    .map((p) => {
      const scores: Weights = {
        // Reach: supporters and accounts in equal parts.
        reach: (p.supporters / topSupporters + p.accounts / topAccounts) / 2,
        businessValue: value(p) / topValue,
      };
      const score =
        totalWeight &&
        (weights.reach * scores.reach +
          weights.businessValue * scores.businessValue) /
          totalWeight;
      return { ...p, scores, score };
    })
    .sort((a, b) => b.score - a.score || a.id - b.id);
}

export type RankedProblem = ReturnType<typeof rank>[number];
