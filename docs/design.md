# Feature Intelligence System — Design

Decisions agreed during the design review (2026-10-11/12). This is the source of truth for scope and architecture; change it when a decision changes.

## Problem and thesis

Feature requests arrive as unstructured, solution-shaped, duplicated text. Every downstream step (vote counts, themes, prioritization, stakeholder updates) inherits that noise. We anchor AI at **intake**: every request is matched to the underlying **Problem** it describes at the moment it's submitted, so the unit of work for the product team becomes a problem, not a request.

- **Core (full depth):** intake — duplicate detection, underlying-need extraction, grouping into Problems.
- **Prioritization (thin):** per-Problem scoring against defined criteria, PM-weighted.
- **Decisions & communication (thin):** on-demand decision brief, PM-recorded decision, AI-drafted stakeholder updates approved by the PM.

Principle: **AI drafts and scores, the PM decides.** Every AI output shows its evidence and is overridable.

### Out of scope

Trend/emerging-need detection, intake from Slack/email/Zendesk, Jira/Linear sync, live CRM, multi-tenant/SSO, any outbound message without PM approval, solution-level voting, content moderation and PII scrubbing (listed as risks).

## Domain model

- **Request** — the submitter's raw title + description, never modified by AI. Author, account, source, timestamps, `status: draft | submitted`. Belongs to exactly one Problem once submitted.
- **Problem** — the cluster. AI-maintained canonical problem statement, tags, list of proposed solution ideas. PM can edit, lock, merge, split. Statement versions are stored; PM-locked statements are never overwritten by AI.
- **Support** — attaches to a Problem, unique per user per Problem. Submitting a Request is implicit support; "+1, this affects me" adds support with an optional "how does this affect you?" note that becomes evidence. Merges dedupe support.
- **Account** — seeded customer data: ARR, segment, churn-risk flag.
- **Event** — append-only log of every action (`type`, `actor: user | pm | ai`, `entityId`, `payload`, `createdAt`). Powers metrics and the audit trail.

Scores, decisions, briefs and notifications hang off the Problem.

## Intake flow

1. **Live match** — after the user pauses typing (`matchDebounceMs`, default 500 ms) once text reaches `matchMinChars` (default 30), and always on "Next": embed title + description, vector-search the top 3 Problems, show "Is this what you're asking for?". One click adds support to an existing Problem instead of creating a Request (deflection).
2. **Clarifying questions** — up to `maxClarifyingQuestions` (default 1; 0 disables; editable in UI for A/B) when the request states a solution but not the need. Skippable.
3. **Post-submit analysis** — one structured LLM call: extract underlying problem, proposed solution, persona, severity, and a categorical verdict against the top-k candidates.
4. **Tiering** (see Confidence) → high: auto-attach ("Grouped into X — not the same? Split it out"); medium: attach + PM review queue; low: create a new Problem.
5. After an attach with new evidence, incrementally update the canonical statement (unless locked).

### Failure handling

No queue, no cron. While a run analyzes a request its status is `analyzing` (shown as such in My requests, with no resubmit); a run older than 5 minutes counts as crashed and the request is a draft again. Each attempt has a 1-minute timeout. Analysis retries automatically 2–3 times. If it still fails, the Request is kept as a **draft** visible only in the author's "My requests" (not public, no support counted, not in the PM queue) with "Submit again", and the user sees an error suggesting they retry later.

### Concurrent duplicates

Two near-identical submissions can race to create two Problems. The LLM call runs outside any lock; Problem creation then runs in one transaction holding `pg_advisory_xact_lock(<problem-creation key>)`, re-runs the vector search, and attaches (flagged for review) if a matching Problem appeared meanwhile, else inserts. Global lock held for milliseconds on the create path only.

## Confidence

LLM self-reported confidence is uncalibrated and not used. The tier is derived from two signals:

- **Embedding similarity** to the best candidate (deterministic).
- **LLM verdict:** `same_problem | related_but_different | different` + rationale.

| Verdict | Similarity | Tier |
|---|---|---|
| same_problem | ≥ T_high | High — auto-attach |
| same_problem | T_low – T_high | Medium — attach + review |
| related_but_different | any | Medium — attach + review |
| same_problem | < T_low | Medium — review (signals disagree) |
| different, or no candidates | any | Low — new Problem (new Problems go to the review queue) |

Rows are checked top to bottom. The creation lock re-checks only Problems created during the analysis; ones the model already judged keep its verdict. Only a high-tier attach refines the Problem statement; a medium one waits for the PM review, so uncertain evidence never rewrites it. Thresholds start provisional (hybrid 0.50/0.75, similarity-only 0.60/0.85; a real paraphrase scored 0.60 with bge-m3) and are tuned on the training split so **high-tier precision ≥ 95%**, stored with the embedding model name. `matchMode: hybrid | similarity-only` (editable in UI) switches off the verdict; each mode has its own thresholds, and the eval reports both as an ablation.

## Prioritization

- **Computed in SQL, always fresh:** Reach (distinct supporters/accounts), Business value (ARR, segment mix, churn flags).
- **LLM-judged:** Strategic fit (vs the PM's strategy doc), Urgency/severity, Effort (labeled as a guess). Each score carries a rationale and citations to specific requests.
- LLM scores are marked **stale** on new evidence or a strategy-doc change; PM rescores manually or via "Rescore all stale". No automatic bulk rescoring.
- Final rank = PM-weighted sum computed in code. PM can override any score with a required reason; the override is logged and shown beside the AI score.

## Decisions and communication

- **Decision brief** — generated on demand per Problem by a tool-using agent: problem statement, who's asking (segments, ARR), representative quotes, score breakdown, 2–3 solution options, open questions/risks.
- **Decision** — PM records `Planned | Under review | Declined | Shipped` + rationale.
- **Stakeholder updates** — on status change, two drafts: customer-facing (built from statement, decision and public rationale only) and internal (full context, sales/CS talking points). PM edits and approves; approved updates go to an in-app notification feed for every supporter.

## AI architecture

- **Deterministic pipelines** for intake, scoring and update drafts: fixed steps, single structured-output calls, testable against a labeled set, no runaway loops.
- **Tool-using agent** only for decision briefs (open-ended evidence gathering): AI SDK `ToolLoopAgent` with read-only tools (`get_problem`, `list_requests`, `get_accounts`, `get_strategy_doc`, `find_related_problems`, `get_score_history`) and a step cap (~8).
- **Vercel AI SDK** for provider independence. Models configured per tier via env as `provider:model` ids resolved through `createProviderRegistry`: `INTAKE_MODEL` (fast; default local `ollama:gemma4:12b`), `REASONING_MODEL` (default local `ollama:qwen3.6:27b`), `EMBEDDING_MODEL` (default local `ollama:bge-m3`, 1024 dims, 8K context). Local models run on Ollama through the `ai-sdk-ollama` provider; hosted Anthropic (`claude-haiku-5-5`, `claude-sonnet-5-5`), Voyage (`voyage-4`, 1024 dims) and OpenAI are one env change away. Embedding model is stored per vector; switching it requires re-embedding (script provided).
- **Reasoning level per call** (AI SDK `reasoning` option, mapped to Ollama `think` and to hosted providers' equivalents): `'none'` for intake analysis, clarifying questions, statement updates, scoring and update drafts, which keeps each call at ~2–5 s on local models. Only the brief agent keeps the provider default, because it runs on demand and depth matters more than latency. Measured on an M3 Pro: gemma4:12b 1.6 s vs 14 s, qwen3.6:27b 4.7 s vs 59 s (thinking off vs on).
- **Local runtime:** the official Ollama app (`brew install --cask ollama-app`). The Homebrew `ollama` formula 0.40.3 ships without the xgrammar library its MLX engine needs, so every structured-output request fails with 501.
- **Recompute cadence:** canonical statement updates incrementally (current statement + new evidence → updated statement or "no change"); plain +1s don't trigger it.

## Trust boundaries

1. `problem_id` in the intake decision must be one of the candidates we passed in; anything else is a failed analysis.
2. User text is passed as delimited data (mitigation, not a guarantee).
3. The customer-facing draft call never receives internal data (ARR, account names, strategy doc).
4. Brief-agent tools are read-only; briefs cite their sources and are drafts for a human.
5. Per-user submission rate limit via Postgres.
6. Moderation and PII scrubbing are not implemented (documented risk).

## Screens

Role switcher (Submitter / PM) instead of auth.

- **Submitter:** Explore (Problems, semantic search, +1), Submit (two-step with live matches, clarifying question, result + split-out), Problem detail (statement, status, public rationale, anonymized Requests such as "a Mid-market customer", update feed), My requests + notifications (incl. drafts).
- **PM (adds):** Review queue (accept / move / split), Prioritization (weights, breakdown, stale badges, override), Problem PM view (statement history + lock, merge/split, brief, decision, update drafts + approve), Strategy & settings (`matchMode`, `maxClarifyingQuestions` editable; thresholds read-only), Metrics (+ latest eval results).

## Metrics

1. **Fewer duplicates** — deflection rate; missed-duplicate rate (AI-created Problems later merged by a PM).
2. **Less triage effort** — hands-off rate (high-tier attaches never touched by a PM); median time to triaged.
3. **Faster stakeholder response** — median time from a Problem's first Request to its supporters' first status update.

Guardrail: **PM override rate** of AI merges, splits and scores. All computed in SQL over `events` on a PM Metrics page. Offline eval numbers serve as the baseline. PostHog deferred (future flags/A-B). LLM tracing via self-hosted **Langfuse v4** (web, worker, Postgres, ClickHouse, Redis, MinIO; ports remapped to avoid clashing with the app) through AI SDK v7 `registerTelemetry` + `@langfuse/otel` in `instrumentation.ts`, enabled only when `LANGFUSE_*` env vars are set.

## Data and evaluation

- Synthetic B2B SaaS ("Ledgerly"-style finance/invoicing platform) fixtures, LLM-generated once, hand-reviewed, committed: `accounts.json` (~30), `problems.json` (~20 ground-truth labels, not loaded as Problems), `requests.json` (~150 with `problemKey`, including solution-shaped, paraphrased, ambiguous, vague, verbose and prompt-injection cases), `strategy.md`.
- Seed runs requests through the real pipeline (`bun run seed`: reset, directory, then every fixture request via `submitRequest` in order).
- Model responses are cached by AI SDK middleware in `data/cache/model-responses.json` (committed), keyed by model and request parameters, so seeding and the eval replay offline with no runtime or API keys.
- The eval replays each request against the **ground-truth state** (the Problems earlier requests should have formed, each stated as intake stated its first request), records candidates, similarities and the verdict once, then scores any thresholds with the same `placeRequest` function intake uses. Tuning on train: `high` = lowest value whose high-tier precision is *confidently* ≥ 95% (lower bound of the 95% Wilson interval); with too little evidence the provisional value stays, unless what was observed at it is below target, in which case nothing auto-groups. Each threshold records its basis (`tuned`, `provisional` or `never`), shown on the Settings page. Similarity-only `low` = best F1 of grouping at high or medium; hybrid reviews by verdict, so its `low` is not used. Reported per mode and split: precision per tier, auto-grouped and grouped recall, new-Problem recall, and retrieval recall@3. Results go to `data/eval/latest.json`; thresholds to `data/eval/thresholds.json`, keyed by embedding model, which intake reads (provisional values otherwise).
- `bun run reembed` re-embeds every request after switching `EMBEDDING_MODEL`; then re-run the eval for that model.
- `bun run eval`: precision/recall per tier, both match modes, ~100 tuning / ~50 held-out split.
- Stretch: eval-only dataset of 300–500 real OSS enhancement issues with duplicate markers as partial ground truth (precision reported as a lower bound), authors anonymized, never loaded into the demo DB.

## Stack

Verified versions and usage notes live in `docs/stack/*.md`; project-level agent skills are in `.claude/skills/` (pinned in `skills-lock.json`).

- **App:** Next.js 16 (App Router, Cache Components on by default), React 19, TypeScript 7. Next runs on Node; bun is the package manager and test runner only.
- **AI:** Vercel AI SDK v7 — `generateText` + `Output.object` for structured calls, `ToolLoopAgent` with `isStepCount` for the brief agent, `embed`/`embedMany`.
- **Data:** Postgres 18 + pgvector, Drizzle ORM (stable 0.45 / drizzle-kit 0.31) over `pg` (node-postgres) with `attachDatabasePool`. HNSW index with cosine ops; order by `cosineDistance` ascending; `SET LOCAL hnsw.iterative_scan = relaxed_order` for filtered top-k.
- **UI:** Tailwind v4 + shadcn/ui on Base UI (`base-nova`).
- **Tooling:** Biome, `bun test`, Zod 4, date-fns 4, `ms` 2.
- **Infra:** Docker Compose locally (Postgres; Langfuse stack optional). Deploy: Vercel + Neon (migrations over the direct URL, app over the pooled URL).

Domain and AI logic live in plain TypeScript modules, not Next-specific ones, so they're testable with `bun test`.

## Build order

0. Docs/skills pass for every library (current idiomatic usage).
1. Foundation — scaffold, tooling, Docker Compose, schema, role switcher, fixtures.
2. Intake core — embeddings, live match, intake call, tiering, locked creation, drafts, submitter screens.
3. Eval — `bun run eval`, threshold tuning, both match modes. (Minimum viable submission.)
4. PM review queue — accept/move/split/merge, statement lock + versions, override events.
5. Prioritization.
6. Brief agent + decisions + stakeholder updates.
7. Metrics page, Langfuse, deploy, README.
8. Stretch — OSS eval dataset.

If scope must shrink: step 6 first (brief only), then step 5 (SQL criteria + strategic fit only). Steps 2–4 are never cut.
