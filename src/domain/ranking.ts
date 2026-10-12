// Pure: the ranking page runs it in the browser, so the order follows the sliders at once.
import type { ProblemCriteria } from "./prioritization";

export const CRITERIA = ["reach", "businessValue"] as const;
export type Criterion = (typeof CRITERIA)[number];
export type Weights = Record<Criterion, number>;

type Top = (of: (p: ProblemCriteria) => number) => number;

// ARR of accounts at risk of churning counts twice. Segment mix is shown, not scored: ARR already follows it.
const value = (p: ProblemCriteria) => p.arr + p.churnRiskArr;

/** Each criterion's 0-1 score for a Problem, given the best value any Problem has. */
const SCORERS: Record<Criterion, (top: Top) => (p: ProblemCriteria) => number> =
  {
    // Supporters and accounts in equal parts.
    reach: (top) => {
      const supporters = top((p) => p.supporters);
      const accounts = top((p) => p.accounts);
      return (p) => (p.supporters / supporters + p.accounts / accounts) / 2;
    },
    businessValue: (top) => {
      const best = top(value);
      return (p) => value(p) / best;
    },
  };

/**
 * Scores each criterion from 0 to 1 against the top Problem on it, then orders by the
 * weighted average of those scores; ties keep the oldest Problem first. Computed in code,
 * so it never waits on a model.
 */
export function rank(problems: ProblemCriteria[], weights: Weights) {
  // ponytail: linear against the top Problem, so one huge account flattens the rest; log-scale ARR if that hides real differences.
  const top: Top = (of) => Math.max(0, ...problems.map(of)) || 1;
  const scorers = CRITERIA.map((c) => [c, SCORERS[c](top)] as const);
  const totalWeight = CRITERIA.reduce((sum, c) => sum + weights[c], 0);

  return problems
    .map((p) => {
      const scores = Object.fromEntries(
        scorers.map(([c, score]) => [c, score(p)]),
      ) as Weights;
      const weighted = CRITERIA.reduce(
        (sum, c) => sum + weights[c] * scores[c],
        0,
      );
      const score = totalWeight === 0 ? 0 : weighted / totalWeight;
      return { ...p, scores, score };
    })
    .sort((a, b) => b.score - a.score || a.id - b.id);
}

export type RankedProblem = ReturnType<typeof rank>[number];
