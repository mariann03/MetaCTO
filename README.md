# Feature Intelligence

An AI-first system for turning raw feature requests into prioritized, explained product decisions, for a B2B SaaS team (the demo data is "Ledgerly", a finance and invoicing platform).

Feature requests arrive as unstructured, solution-shaped and duplicated text, and everything downstream inherits that noise: vote counts, themes, prioritization, the replies customers get. This system puts the AI at **intake**. Every request is matched, when it is submitted, to the underlying **Problem** it describes, so the product team works on problems instead of requests.

The guiding principle is **AI drafts and scores, the PM decides**. Every AI output shows its evidence, and a PM can override it.

- **Live demo:** https://metacto.mariann.dev. It runs on the author's machine (local models, local Postgres) behind a Cloudflare Tunnel, so it can be offline, and anyone with the link can act as a PM. See [Deploying](#deploying).
- **Design source of truth:** [`docs/design.md`](docs/design.md). The intake model comparison is in [`docs/eval-intake-setups.md`](docs/eval-intake-setups.md).

## What it does

**For customers (submitters)**

- **Submit a request in two steps.** As they type, similar Problems appear ("Is this what you're asking for?"), and one click adds their support instead of filing a duplicate. If the request names a solution but not the need behind it, a short clarifying question is asked; it can always be skipped.
- **Explore** Problems by meaning (semantic search), filter by status, and +1 with an optional "how does this affect you?" note.
- **Open a Problem** to see its statement, status, the public reason for the decision, the update feed, and the requests behind it, anonymized to the customer's segment ("A Mid-market customer").
- **My requests and Notifications**: track what they asked for, resubmit a draft whose analysis failed, dispute a grouping ("Not the same? Split it out"), and receive the status updates a PM approved.

**For product managers**

- **Review queue**: accept, move or split the groupings the AI was unsure about, with its verdict, rationale and the candidates it compared.
- **Curate Problems**: merge duplicates the AI missed, rewrite and lock a statement (the AI never rewrites a locked one), and see who wrote each version.
- **Prioritize**: weight five criteria with sliders. Reach and Business value are computed from supporters and ARR; Strategic fit, Urgency and Effort are AI scores, each with a rationale citing requests. Scores go stale when evidence or the strategy changes, and the PM rescores and overrides with a reason.
- **Decide and communicate**: generate a decision brief (an agent gathers the evidence and cites every claim), record a decision with a public rationale, then edit and approve two AI-drafted updates, one for customers and one for Sales and CS.
- **Measure**: business and AI-quality metrics from the event log, next to the latest offline evaluation.
- **Settings**: the strategy document, the clarifying-question limit and the matching mode; the matching thresholds are read-only, set by the eval.

There is no login: a header switcher acts as any seeded customer or PM.

## Running it locally

**Requirements**

- [bun](https://bun.sh) (package manager, scripts and unit tests) and Node.js 22 or newer (Next.js runs on Node).
- Docker, for Postgres with pgvector.
- For the AI: the official [Ollama](https://ollama.com) app (`brew install --cask ollama-app`), with the models pulled:
  ```sh
  ollama pull gemma4:12b    # intake: analysis, clarifying questions, statements
  ollama pull qwen3.6:27b   # reasoning: scoring, update drafts, decision brief
  ollama pull bge-m3        # embeddings
  ```
  qwen3.6:27b needs about 20–33 GB of memory; on a smaller machine point `REASONING_MODEL` at a hosted model (see below). The Homebrew `ollama` formula does not work: it ships without the library its structured output needs.

**Setup**

```sh
bun install
cp .env.example .env
docker compose up -d          # Postgres 18 + pgvector on :5432
bun run db:migrate
bun run seed                  # 30 accounts, 60 people, 150 requests through the real intake
bun run dev                   # http://localhost:3000
```

`bun run seed` replays the model answers committed in `data/cache/`, so it runs offline in seconds, with no model or API key. It only calls a model for answers that are not cached.

**Hosted models.** Every model is a `provider:model` id in `.env`, so switching is one line, e.g. `INTAKE_MODEL=anthropic:claude-haiku-5-5`, `REASONING_MODEL=anthropic:claude-sonnet-5-5`, `EMBEDDING_MODEL=voyage:voyage-4` (with the matching API keys). After changing the embedding model, run `bun run reembed` and `bun run eval`.

**Checks**

```sh
bun run lint && bun run typecheck
bun test               # service tests on a real test Postgres with scripted models
bun run test:e2e       # Playwright against a production build with a deterministic fake AI
bun run eval           # matching accuracy on the labeled fixtures (replays from the cache)
```

**Tracing (optional).** `bun run langfuse:up` starts a local Langfuse on http://localhost:3001 (`bun run langfuse:down` stops it, keeping its data) (login `dev@example.com` / `local-password`). Uncomment the three `LANGFUSE_*` lines in `.env` and restart the app: every AI call then appears as a trace with its prompt, output, tokens and latency, including the brief agent's tool calls. Without them, tracing is not loaded at all.

## Deploying

**Production target: Vercel + Neon.** The app is built for it and needs no code changes, only configuration:

1. Create a Neon project. The first migration enables `pgvector`, which Neon supports.
2. Set two URLs: `DATABASE_URL` is Neon's pooled (`-pooler`) URL, which the app uses; `DATABASE_URL_UNPOOLED` is the direct URL, which migrations use. The `pg` pool is attached with `@vercel/functions` so idle clients close before a function suspends.
3. Choose hosted models, since Vercel cannot reach a local Ollama: e.g. `INTAKE_MODEL=anthropic:claude-haiku-5-5`, `REASONING_MODEL=anthropic:claude-sonnet-5-5`, `EMBEDDING_MODEL=voyage:voyage-4`, with `ANTHROPIC_API_KEY` and `VOYAGE_API_KEY`. Set the same variables in the Vercel project, plus the optional `LANGFUSE_*` ones.
4. From a machine with those variables: `bun run db:migrate`, then `bun run seed` (its answers are not cached for new models, so it calls them once).
5. Matching thresholds are stored per embedding model, so run `bun run eval` with the new models and commit `data/eval/` before deploying; until then intake uses the provisional thresholds.
6. Deploy with `vercel` (or by connecting the repo). Long AI work the PM asks for (rescoring everything, a decision brief) runs after the response with `after()`, which Vercel's Fluid compute keeps alive up to the function's maximum duration; hosted models finish well within it.

**The demo today** runs locally instead, so it uses the same local models the evaluation measured: `bun run build && bun run start` serves the app on :3000, and a Cloudflare Tunnel (`cloudflared tunnel --config ~/.cloudflared/metacto.yml run metacto`) publishes it at https://metacto.mariann.dev.

## Architecture

```
Next.js 16 (App Router, server actions)        src/app, src/components
  └─ domain modules (plain TypeScript)          src/domain   ← all business logic, tested with bun test
       ├─ Postgres 18 + pgvector via Drizzle    src/db, drizzle/
       └─ AI SDK v7 models per tier             src/ai       ← Ollama by default, hosted via env
```

- **Domain logic lives in plain modules** (`intake`, `review`, `curation`, `scoring`, `ranking`, `decisions`, `brief`, `metrics`, …), not in Next.js files, so it is tested directly against a real database. Pages and server actions are thin: they validate input with Zod, check the role, and call the domain.
- **Postgres does the heavy lifting**: vector search (HNSW, cosine), the creation lock that stops two near-identical submissions from creating two Problems, row locks for concurrent PM actions, check constraints, and every metric (SQL over the event log).
- **Every action is an event** in an append-only `events` table (actor user, PM or AI). It is the audit trail and the only source of the metrics.
- **No queue, no cron.** Intake runs during the submission with retries and keeps a draft if it fails. Long AI work the PM asks for (rescoring everything, a decision brief) runs after the response, with Next.js `after()`.

## AI design decisions

- **Deterministic pipelines over agents.** Intake, clarifying questions, statement updates, scoring and update drafts are each a single structured-output call with fixed inputs. They are testable against labeled data and cannot loop. The one open-ended task, the decision brief, is the one agent: a `ToolLoopAgent` with six read-only tools bound to one Problem and a cap of 8 steps.
- **Matching combines two signals.** A request's embedding finds the closest Problems (each at its best-matching request); then one model call extracts the underlying need and gives a categorical verdict (`same_problem`, `related_but_different`, `different`) against the top 3. The model's self-reported confidence is uncalibrated, so it is not used. The **tier** comes from the verdict and the similarity together: high auto-groups, medium groups and asks a PM, low starts a new Problem (which a PM also reviews).
- **Thresholds are tuned, not guessed.** `bun run eval` replays the 150 labeled requests, tunes the thresholds on a ~100 request training split, and reports on ~50 held out. Auto-grouping is enabled only where its precision is *confidently* at least 95% (the lower bound of a 95% Wilson interval). With today's data that bar is rarely met, so almost everything goes through review. That is deliberate: a wrong auto-group is worse than a review.
- **Thinking is on for intake.** Comparing six setups showed that letting gemma4:12b think groups 11–19 points more duplicates at the same or better precision, for about 3 times the latency (30 s median per submission). Bigger models, more candidates and prompt changes did worse. Everything else runs with thinking off, except the brief agent. See [`docs/eval-intake-setups.md`](docs/eval-intake-setups.md).
- **Provider independence.** Each tier (intake, reasoning, embedding) is an env setting resolved through the AI SDK provider registry: Ollama by default, Anthropic, OpenAI or Voyage by changing one line.
- **Reproducibility.** Model answers are cached by request parameters and committed, so the seed and the eval replay offline and the numbers in this repo can be regenerated without a GPU. The E2E suite uses a deterministic fake model instead.
- **Model output is checked, not trusted.** The intake verdict may only name a Problem it was offered; a score or a brief may only cite requests and sources its tools returned; a brief's quotes are kept only when copied word for word from the request they cite. Anything else fails that call, which is logged and retried by a person.

## Where humans stay in the loop

- **Groupings**: every medium- and low-tier request goes to the PM review queue; submitters can dispute a grouping; PMs move, split and merge.
- **Wording**: PMs edit and lock Problem statements; the AI only refines unlocked ones, and only from confident groupings or reviewed ones.
- **Priorities**: PMs set the weights, decide when to spend model time on rescoring, and override any AI score with a required reason, shown beside the AI's.
- **Decisions**: the brief is a draft with linked sources; the decision and its rationale are the PM's.
- **Communication**: nothing reaches a customer without a PM approving it. The customer draft is built only from the statement, the decision and the public rationale, so it cannot leak ARR, account names or the strategy.

## Metrics

The PM Metrics page computes, in SQL over the event log:

| Goal | Metric |
|---|---|
| Fewer duplicates | Deflection rate (a +1 instead of a new request); missed-duplicate rate (AI-created Problems a PM later merged away or emptied in review) |
| Less triage effort | Hands-off rate (confident groupings no PM touched); median time to triaged |
| Faster stakeholder response | Median time from a Problem's creation to its supporters' first approved update |
| Guardrail | PM override rate of AI groupings, merges and scores |

Before real usage, the offline evaluation is the baseline, shown on the same page. On the held-out requests the adopted setup groups 53% of duplicates correctly with 77% precision on the requests it sends to review, keeps 80% of new needs separate, and finds the right Problem among its 3 candidates 76% of the time.

**On real data.** The fixtures are synthetic, so the same setup is also measured on 325 real microsoft/vscode feature requests, 103 of them duplicates its maintainers marked (`bun run eval --dataset vscode`). Their duplicate labels are incomplete, so precision there is a lower bound. VSCODE_RESULTS

## Assumptions

- One workspace; customers are identified by a seeded directory (accounts with ARR, segment and churn risk). No real auth, CRM sync or intake from email, Slack or support tools.
- Requests are short text. Customers write in English.
- A PM reviews the queue regularly; the system is built to make that review fast, not to remove it.
- The demo data is synthetic: generated once, hand-reviewed and committed, with deliberate hard cases (paraphrases, solution-shaped requests, vague ones and prompt-injection attempts).

## Risks and trade-offs

- **Latency for accuracy.** Thinking on makes a submission wait about 30 s (about 74 s at p90). Moving analysis after submission would remove the wait; the product would then tell the customer when their request was grouped.
- **Little auto-grouping.** With 150 labeled requests, auto-grouping can rarely be shown to be 95% precise, so PMs review most groupings. More labeled data (or a stronger model) is what unlocks hands-off triage.
- **Prompt injection.** Customer text is passed as delimited, escaped data and model outputs are validated, which limits but cannot rule out manipulation. The worst case is a wrong grouping or a weak draft, both of which a PM reviews.
- **No moderation or PII scrubbing.** Request text is shown to other customers word for word (authors are anonymized to their segment). This is a known risk, not handled here.
- **Local models are slow and big.** The defaults keep everything on one machine and free; a hosted model is faster and likely more accurate, at a cost per call.
- **Scale ceilings are marked in the code** with `ponytail:` comments: e.g. Explore search scans every request, the metrics scan the whole event log, the merge picker lists every Problem, and the Priorities page sends every open Problem to the browser. All are fine at demo scale and say what to change beyond it.

## Repository map

| Path | What |
|---|---|
| `src/domain/` | Business logic and its tests |
| `src/app/`, `src/components/` | Pages, server actions, UI (shadcn/ui on Base UI) |
| `src/ai/` | Model registry, response cache, the E2E fake |
| `src/db/`, `drizzle/` | Schema and migrations |
| `data/fixtures/` | Accounts, people, labeled requests, strategy |
| `data/cache/`, `data/eval/` | Cached model answers; eval results and tuned thresholds; the eval-only vscode dataset (`data/eval/oss/`) |
| `scripts/` | `seed`, `eval`, `reembed`, the vscode dataset builder, fixture validation |
| `e2e/` | Playwright specs |
| `docs/` | Design, eval notes, verified library notes |
