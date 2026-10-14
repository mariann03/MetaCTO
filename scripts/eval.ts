// Measures matching on the labeled fixtures and tunes thresholds per mode on the train split.
// Every setup's results go to data/eval/runs/. The setup intake runs with also writes
// data/eval/latest.json (shown on the metrics page) and data/eval/thresholds.json (used by
// intake, keyed by embedding model). Model answers are cached in data/cache.
//   bun run eval [--intake-model ollama:qwen3.6:27b] [--candidates 5] [--reasoning provider-default]
//                [--dataset vscode]
// Without flags it measures the setup intake runs with: INTAKE_MODEL and INTAKE_SETUP, on the
// fixtures. --dataset vscode measures it on real vscode feature requests instead; their
// duplicate labels are incomplete, so precision there is a lower bound, and those runs never
// change what intake runs with.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { createCachedModels } from "@/ai/cached-models";
import { embeddingModelName } from "@/ai/models";
import { DATASETS, loadRequestFixtures } from "@/db/fixtures";
import {
  collectObservations,
  type Metrics,
  type Observation,
  retrievalRecall,
  type Split,
  score,
  tune,
} from "@/domain/evaluation";
import {
  INTAKE_PROMPT_ID,
  INTAKE_SETUP,
  type IntakeSetup,
  type TunedThresholds,
  tunedThresholdsSchema,
} from "@/domain/intake";
import type { MatchMode } from "@/domain/settings";
import { readEnv } from "@/env";

const { values: flags } = parseArgs({
  options: {
    "intake-model": { type: "string" },
    candidates: { type: "string" },
    reasoning: { type: "string" },
    dataset: { type: "string" },
  },
});
const appEnv = readEnv();
const env = readEnv({
  ...process.env,
  INTAKE_MODEL: flags["intake-model"] ?? appEnv.INTAKE_MODEL,
});
const setup: IntakeSetup = z
  .object({
    candidates: z.coerce.number().int().min(1),
    reasoning: z.enum([
      "provider-default",
      "none",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]),
  })
  .parse({ ...INTAKE_SETUP, ...flags });
const dataset = z.enum(DATASETS).default("fixtures").parse(flags.dataset);
// Real-world data: its duplicate labels are incomplete, and it never tunes intake.
const realWorld = dataset !== "fixtures";
const setupName = `prompt=${INTAKE_PROMPT_ID} candidates=${setup.candidates} reasoning=${setup.reasoning}`;
// The fixtures keep their unprefixed names, so earlier runs and cached answers still match.
const datasetPrefix = realWorld ? `${dataset} ` : "";
const runName = `${datasetPrefix}${setupName}`;
const isIntakeSetup =
  !realWorld &&
  env.INTAKE_MODEL === appEnv.INTAKE_MODEL &&
  setup.candidates === INTAKE_SETUP.candidates &&
  setup.reasoning === INTAKE_SETUP.reasoning;

// Model time of the current request (every model call it made: embedding, intake, failed
// attempts): what it took live, even when replayed from the cache.
let requestMs = 0;
const { models, save } = createCachedModels(env, `eval ${runName}`, (ms) => {
  requestMs += ms;
});
const fixtures = await loadRequestFixtures(dataset);
const latencies: number[] = [];

let observations: Observation[];
try {
  observations = await collectObservations(
    models,
    fixtures,
    setup,
    (done, total) => {
      latencies.push(requestMs);
      requestMs = 0;
      if (done % 10 === 0 || done === total) {
        save();
        console.log(`Replayed ${done}/${total} requests`);
      }
    },
  );
  save({ complete: true });
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
const sorted = latencies.toSorted((a, b) => a - b);
// Nearest rank: the smallest value with at least p of the requests at or below it.
const percentile = (p: number) =>
  sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] ?? 0;
const latency = { medianMs: percentile(0.5), p90Ms: percentile(0.9) };
console.log(
  `\nEmbedding ${embeddingModel}, intake ${env.INTAKE_MODEL}, ${setupName}; ${observations.length}/${fixtures.length} requests analyzed`,
);
if (realWorld)
  console.log(
    `Dataset ${dataset}: duplicate labels are incomplete, so every precision below is a lower bound.`,
  );
console.log(
  `Retrieval: the right Problem was among the ${setup.candidates} candidates for ${pct(retrieval)} of groupable requests`,
);
console.log(
  `Model time per request (all its model calls): median ${(latency.medianMs / 1000).toFixed(1)} s, p90 ${(latency.p90Ms / 1000).toFixed(1)} s`,
);
for (const [mode, r] of Object.entries(modes)) {
  console.log(
    `\n${mode}: low ${r.thresholds.low}, high ${r.thresholds.high} (${r.thresholds.basis})`,
  );
  console.log(`  train   ${row(r.train)}`);
  console.log(`  holdout ${row(r.holdout)}`);
}

const results = `${JSON.stringify(
  {
    runAt: new Date().toISOString(),
    embeddingModel,
    intakeModel: env.INTAKE_MODEL,
    dataset,
    // Unlabeled duplicates count as wrong groupings, so true precision can only be higher.
    precisionIsLowerBound: realWorld,
    prompt: INTAKE_PROMPT_ID,
    setup,
    requests: fixtures.length,
    analyzed: observations.length,
    retrievalRecall: retrieval,
    latency,
    modes,
  },
  null,
  2,
)}\n`;
const evalDir = join(process.cwd(), "data", "eval");
const runFile = `${datasetPrefix}${env.INTAKE_MODEL} ${setupName}`.replace(
  /[^\w.=-]+/g,
  "_",
);
mkdirSync(join(evalDir, "runs"), { recursive: true });
writeFileSync(join(evalDir, "runs", `${runFile}.json`), results);
console.log(`\nWrote data/eval/runs/${runFile}.json`);
// Other setups are experiments: they must not change what intake runs with.
if (!isIntakeSetup) process.exit(0);

writeFileSync(join(evalDir, "latest.json"), results);
const thresholdsPath = join(evalDir, "thresholds.json");
const tuned: TunedThresholds = tunedThresholdsSchema.parse(
  JSON.parse(readFileSync(thresholdsPath, "utf8")),
);
tuned[embeddingModel] = {
  hybrid: modes.hybrid.thresholds,
  "similarity-only": modes["similarity-only"].thresholds,
};
writeFileSync(thresholdsPath, `${JSON.stringify(tuned, null, 2)}\n`);
console.log("Wrote data/eval/latest.json and data/eval/thresholds.json");
