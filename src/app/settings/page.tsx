import { Suspense } from "react";
import { embeddingModelName } from "@/ai/models";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { thresholdsFor } from "@/domain/intake";
import {
  getMatchMode,
  getMaxClarifyingQuestions,
  getStrategy,
  MATCH_MODES,
  MAX_CLARIFYING_QUESTIONS,
} from "@/domain/settings";
import { deps } from "@/server/deps";
import { getSession } from "@/server/session";
import { ClarifyingForm } from "./clarifying-form";
import { MatchModeForm } from "./match-mode-form";
import { StrategyForm } from "./strategy-form";

const BASIS = {
  tuned: "Tuned on enough evidence",
  provisional: "Provisional: too little evidence to tune",
  never: "Never: not precise enough to auto-group",
} as const;

export default function SettingsPage() {
  return (
    <section className="max-w-2xl space-y-6">
      <h1 className="font-semibold text-2xl">Settings</h1>
      <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
        <MatchingSettings />
      </Suspense>
    </section>
  );
}

async function MatchingSettings() {
  const { current } = await getSession();
  if (current?.role !== "pm")
    return (
      <p className="text-muted-foreground">
        Only product managers can change settings.
      </p>
    );

  const [mode, strategy, maxQuestions] = await Promise.all([
    getMatchMode(deps),
    getStrategy(deps),
    getMaxClarifyingQuestions(deps),
  ]);
  const embeddingModel = embeddingModelName(deps.models.embedding);
  const modes = thresholdsFor(embeddingModel);
  return (
    <div className="space-y-8">
      <StrategyForm strategy={strategy} />
      <ClarifyingForm max={maxQuestions} limit={MAX_CLARIFYING_QUESTIONS} />
      <MatchModeForm mode={mode} />
      <Table className="-mt-4">
        <TableCaption>
          Thresholds in use for {embeddingModel} (set by the evaluation,
          read-only)
        </TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Mode</TableHead>
            <TableHead>Review from</TableHead>
            <TableHead>Auto-group from</TableHead>
            <TableHead>Basis</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {MATCH_MODES.map((name) => {
            const t = modes[name];
            return (
              <TableRow key={name}>
                <TableCell>{name}</TableCell>
                <TableCell>
                  {name === "hybrid" ? "AI verdict" : t.low}
                </TableCell>
                <TableCell>{t.high > 1 ? "never" : t.high}</TableCell>
                <TableCell>{BASIS[t.basis]}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
