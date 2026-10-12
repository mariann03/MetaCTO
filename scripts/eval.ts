// Measures matching on the labeled fixtures and tunes thresholds per mode on the train split.
// Writes data/eval/latest.json (shown on the metrics page) and data/eval/thresholds.json
// (used by intake, keyed by embedding model). Model answers are cached in data/cache.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createCachedModels } from "@/ai/cached-models";
import { embeddingModelName } from "@/ai/models";
import { loadRequestFixtures } from "@/db/fixtures";
import {
  collectObservations,
  type Metrics,
  type Observation,
  retrievalRecall,
  type Split,
  score,
  tune,
} from "@/domain/evaluation";
import { type TunedThresholds, tunedThresholdsSchema } from "@/domain/intake";
import type { MatchMode } from "@/domain/settings";
import { readEnv } from "@/env";

const env = readEnv();
const { models, save } = createCachedModels(env);
const fixtures = await loadRequestFixtures();

let observations: Observation[];
try {
  observations = await collectObservations(models, fixtures, (done, total) => {
    if (done % 10 === 0 || done === total) {
      save();
      console.log(`Replayed ${done}/${total} requests`);
    }
  });
} finally {
  save();
}

const embeddingModel = embeddingModelName(models.embedding);
/** Tunes one mode on train and scores it on both splits. */
function evaluate(mode: MatchMode) {
  const thresholds = tune(observations, mode);
  const split = (s: Split) =>
    score(
      observations.filter((o) => o.split === s),
      mode,
      thresholds,
    );
  return { thresholds, train: split("train"), holdout: split("holdout") };
}
const modes = {
  hybrid: evaluate("hybrid"),
  "similarity-only": evaluate("similarity-only"),
} satisfies Record<MatchMode, unknown>;

const pct = (v: number | null) =>
  v === null ? "  n/a" : `${(v * 100).toFixed(0).padStart(4)}%`;
const row = (m: Metrics) =>
  `high ${String(m.high.count).padStart(3)} @${pct(m.high.precision)} | medium ${String(m.medium.count).padStart(3)} @${pct(m.medium.precision)} | low ${String(m.low.count).padStart(3)} @${pct(m.low.precision)} | auto-grouped ${pct(m.highRecall)} | grouped ${pct(m.attachRecall)} | new kept new ${pct(m.newRecall)}`;
const retrieval = retrievalRecall(observations);
console.log(
  `\nEmbedding ${embeddingModel}, intake ${env.INTAKE_MODEL}; ${observations.length}/${fixtures.length} requests analyzed`,
);
console.log(
  `Retrieval: the right Problem was among the candidates for ${pct(retrieval)} of groupable requests`,
);
for (const [mode, r] of Object.entries(modes)) {
  console.log(
    `\n${mode}: low ${r.thresholds.low}, high ${r.thresholds.high} (${r.thresholds.basis})`,
  );
  console.log(`  train   ${row(r.train)}`);
  console.log(`  holdout ${row(r.holdout)}`);
}

const evalDir = join(process.cwd(), "data", "eval");
writeFileSync(
  join(evalDir, "latest.json"),
  `${JSON.stringify(
    {
      runAt: new Date().toISOString(),
      embeddingModel,
      intakeModel: env.INTAKE_MODEL,
      requests: fixtures.length,
      analyzed: observations.length,
      retrievalRecall: retrieval,
      modes,
    },
    null,
    2,
  )}\n`,
);
const thresholdsPath = join(evalDir, "thresholds.json");
const tuned: TunedThresholds = tunedThresholdsSchema.parse(
  JSON.parse(readFileSync(thresholdsPath, "utf8")),
);
tuned[embeddingModel] = {
  hybrid: modes.hybrid.thresholds,
  "similarity-only": modes["similarity-only"].thresholds,
};
writeFileSync(thresholdsPath, `${JSON.stringify(tuned, null, 2)}\n`);
console.log("\nWrote data/eval/latest.json and data/eval/thresholds.json");
