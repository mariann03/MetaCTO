# Intake setups compared (#23)

Intake asks a model whether a new request is the same problem as one of its closest
Problems. This note compares the setups we measured and why intake now runs with gemma4:12b
**thinking on**. Every number comes from `bun run eval` on the 150 labeled fixture requests
(about 100 tune, 50 held out), in hybrid mode. Each setup's full results are in
`data/eval/runs/`, and its model answers are in the cache, so the whole table replays offline.

## What is measured

- **Grouped recall**: of the requests that belong to an existing Problem, the share grouped
  into the right one (auto-grouped or sent to review). This is what duplicate detection is for.
- **Medium precision**: of the requests sent to review as a match, the share that really
  belong to the Problem named. Low precision means PMs spend reviews undoing wrong groupings.
- **New kept new**: of the requests that start a genuinely new problem, the share that did.
  If this drops, real new needs get buried inside unrelated Problems.
- **Retrieval recall@k**: how often the right Problem was among the k candidates the model
  saw. No verdict can beat it.
- **Model time per request**: the live time of all of a request's model calls (embedding
  and intake verdict, including failed attempts), also when the eval replays from the cache.
  The customer waits on it, because analysis runs during submission.

## Results

Train / holdout. The current prompt is `edb47c00`.

| Setup | Grouped recall | Medium precision | New kept new | Retrieval | Median / p90 time |
|---|---|---|---|---|---|
| gemma4:12b, thinking off (before) | 38% / 42% | 63% / 75% | 67% / 80% | 76% @3 | 11.2 s / 14.1 s |
| gemma4:12b, 5 candidates | 41% / 47% | 58% / 69% | 67% / 80% | 82% @5 | 12.4 s / 14.6 s |
| qwen3.6:27b, thinking off | 44% / 41% | 76% / 89% | 75% / 80% | 75% @3 | 21.9 s / 27.4 s |
| **gemma4:12b, thinking on (adopted)** | **57% / 53%** | **68% / 77%** | **71% / 80%** | 76% @3 | **30.1 s / 74.2 s** |
| Prompt `4787fccb`: granularity rule | 65% / 69% | 52% / 61% | 5% / 0% | 76% @3 | 14.1 s / 17.7 s |
| Prompt `eb38391c`: rationale first | 44% / 43% | 60% / 56% | 57% / 40% | 76% @3 | 14.5 s / 18.8 s |

qwen3.6:27b failed to analyze 4 of the 150 requests; the rationale-first prompt failed 1.
Times are nearest-rank percentiles; the two prompt variants' runs predate that fix (their
p90 may read one rank high), since their prompts are no longer in the code to replay.

## What each change did

- **More candidates (5 instead of 3)** puts the right Problem in front of the model more
  often (retrieval 76% to 82%). Grouping rose only 3 to 5 points, and precision fell, because
  the extra candidates are also extra ways to be wrong. It is not worth the cost.
- **A bigger model (qwen3.6:27b)** is the most precise: 89% of its holdout matches were right.
  It barely groups more, takes twice the time, and needs about 33 GB of the machine's 36 GB.
  On this laptop that rules it out for a step that runs on every submission.
- **Thinking on** is the only change that improved every quality measure at once: 11 to 19
  points more duplicates grouped (19 on train, 11 on holdout), slightly better precision, and
  new problems kept new as often as before. It costs about 3 times the time, with a long tail.
- **Prompt changes did not help.**
  - The granularity rule told the model that one piece of product work makes one Problem,
    and to answer related_but_different only when solving the candidate would leave the need
    unmet. The model then almost never answered "different". It grouped more, but buried
    nearly every new need inside an existing Problem.
  - Asking for the rationale before the verdict (reason, then answer) changed little and made
    precision worse.

Why recall was low to begin with: replaying the misses of the original setup, the model saw
the right Problem in 94 cases and still split 74 of them, half as related_but_different and
half as different. It split on a different symptom, example, scope or proposed solution: a
SIEM audit stream against an audit trail, EUR and GBP invoices against currency bank details,
a PO number field against custom fields. Thinking on is what fixed most of these.

## The trade-off we chose

Grouping duplicates is the point of the product, so we took recall and paid in latency:

- A submission now waits about 30 s at the median for its analysis, up from 11 s, and 74 s
  at p90. The per-attempt timeout went from 1 to 2 minutes so the slow tail completes instead
  of falling back to a draft.
- Precision did not suffer, so the review queue does not grow with false matches. It grows
  with the extra true matches that hybrid mode sends to review.
- Nearly nothing is auto-grouped in any setup (one holdout request). The high tier needs both
  a same_problem verdict and similarity of at least 0.75, which rarely happen together with
  bge-m3. Tuning the high threshold needs more labeled evidence than 100 requests give.

## What would move it next

- Run the analysis after submission instead of during it, with the customer told when it
  lands. Thinking on would then cost nothing anyone waits for.
- A hosted model (one env change, e.g. `INTAKE_MODEL=anthropic:claude-haiku-5-5`) is likely
  both faster and better at this judgement. It is worth adding to this table once there is a
  key to run it with. Note that `INTAKE_SETUP` asks for the provider's default reasoning,
  which means thinking on for gemma4 on Ollama but may mean none elsewhere, so measure it
  with an explicit `--reasoning` level.
- A larger labeled set would let the high tier be tuned, so confident matches skip review.

## Reproducing

```sh
bun run eval                                            # the adopted setup; also writes latest.json and thresholds.json
bun run eval --reasoning none                           # thinking off
bun run eval --candidates 5 --reasoning none
bun run eval --intake-model ollama:qwen3.6:27b --reasoning none
```

Each run writes `data/eval/runs/<model>_prompt=<id>_candidates=<n>_reasoning=<level>.json`.
The two prompt variants are no longer in the code. Their results stay in `runs/` under their
prompt ids, and their answers stay in the cache: a completed run only prunes its own entries,
so a prompt's entries stay until its run record is removed from the cache file.
