"use client";

import { useState } from "react";
import { Slider } from "@/components/ui/slider";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ProblemCriteria } from "@/domain/prioritization";
import { CRITERIA, type Criterion, rank, type Weights } from "@/domain/ranking";

const NAME: Record<Criterion, string> = {
  reach: "Reach",
  businessValue: "Business value",
};
const SEGMENT: Record<keyof ProblemCriteria["segments"], string> = {
  smb: "SMB",
  mid_market: "Mid-market",
  enterprise: "Enterprise",
};
const MAX_WEIGHT = 10;

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const points = (score: number) => Math.round(score * 100);
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** Problems ranked by the PM's weights; moving a slider reorders them at once, in the browser. */
export function Ranking({ criteria }: { criteria: ProblemCriteria[] }) {
  // ponytail: weights reset on reload; persist them in settings once PMs want a saved ranking.
  const [weights, setWeights] = useState<Weights>({
    reach: 5,
    businessValue: 5,
  });
  const ranked = rank(criteria, weights);

  return (
    <div className="space-y-6">
      <fieldset className="grid max-w-xl gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-muted-foreground text-sm">
          Weights (0 to {MAX_WEIGHT})
        </legend>
        {CRITERIA.map((criterion) => (
          <div key={criterion} className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>{NAME[criterion]}</span>
              <span className="tabular-nums">{weights[criterion]}</span>
            </div>
            <Slider
              thumbLabel={`${NAME[criterion]} weight`}
              min={0}
              max={MAX_WEIGHT}
              value={[weights[criterion]]}
              onValueChange={(value) =>
                setWeights((w) => ({
                  ...w,
                  [criterion]: Array.isArray(value) ? value[0] : value,
                }))
              }
            />
          </div>
        ))}
      </fieldset>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12">#</TableHead>
            <TableHead>Problem</TableHead>
            <TableHead>Reach</TableHead>
            <TableHead>Business value</TableHead>
            <TableHead className="text-right">Score</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ranked.map((p, i) => (
            <TableRow key={p.id}>
              <TableCell className="tabular-nums">{i + 1}</TableCell>
              <TableCell className="whitespace-normal">{p.statement}</TableCell>
              <TableCell>
                <div className="tabular-nums">{points(p.scores.reach)}</div>
                <div className="text-muted-foreground text-xs">
                  {plural(p.supporters, "supporter")}
                  {" · "}
                  {plural(p.accounts, "account")}
                </div>
              </TableCell>
              <TableCell>
                <div className="tabular-nums">
                  {points(p.scores.businessValue)}
                </div>
                <div className="text-muted-foreground text-xs">
                  {usd.format(p.arr)} ARR
                  {p.churnRiskArr > 0 &&
                    ` · ${usd.format(p.churnRiskArr)} at risk`}
                </div>
                <div className="text-muted-foreground text-xs">
                  {Object.entries(p.segments)
                    .filter(([, n]) => n > 0)
                    .map(
                      ([segment, n]) =>
                        `${n} ${SEGMENT[segment as keyof typeof SEGMENT]}`,
                    )
                    .join(", ")}
                </div>
              </TableCell>
              <TableCell className="text-right font-medium tabular-nums">
                {points(p.score)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
