# Loom demo script

A walkthrough of about 10 minutes on the seeded data (Ledgerly, a finance and invoicing product). It follows a request from a customer to a decision the customer hears back about. Problem numbers refer to a fresh `bun run seed`, which replays cached answers and so always produces the same data.

## Before recording

- `bun run seed` for a clean database (a minute, offline), then `bun run build && bun run start`, or use https://metacto.mariann.dev.
- Warm the models so the first call doesn't include loading them: `ollama run gemma4:12b "hi"` and `ollama run qwen3.6:27b "hi"`. Both need about 50 GB together; on a 36 GB machine, warm only the one the next step uses.
- **Generate the brief ahead of time** (step 7): as a PM, open Problem 1 and press *Generate brief*. It takes about 7 minutes on qwen3.6:27b; reload the page to see it.
- Optional, for step 10: `bun run langfuse:up`, set the three `LANGFUSE_*` lines in `.env`, restart the app.

## 1. The problem (30 s)

Feature requests arrive as solution-shaped, duplicated text, and everything downstream inherits that noise. Here the AI works at **intake**: each request is matched to the underlying **Problem** as it is submitted. AI drafts and scores; the PM decides.

## 2. Deflection: the duplicate never gets filed (1 min)

Act as **Maria Delgado** (an SMB customer). Open **Submit** and start typing:

- Title: `Bank details changed without a trace`
- Description: `Someone edited a supplier's bank account last week and we only noticed when a payment bounced. We need to see who changed what.`

After a pause, *Is this what you're asking for?* shows the audit-trail Problem. That match is embedding-only, so no LLM call. Press **+1, this affects me**, add a note, and the request is never filed. That counts as a deflection on the Metrics page.

## 3. A clarifying question, then intake (1.5 min)

Still as Maria, write a solution with no reason:

- Title: `Slack integration`
- Description: `Please add a Slack integration.`

Press **Next**. A clarifying question appears: the request names a solution but not the need. Answer it, e.g. `Approvers miss bills waiting for them; we want a ping in Slack when a bill needs approval.` Then press **Submit request**.

The analysis runs with thinking on, taking about 30 s. That's the trade-off the eval chose: 11–19 points more duplicates grouped (see step 9). The result says where the request went. In our run it started a new Problem (approvers missing bills that wait for them); with thinking on it may instead join the bill-approval Problem, which is then sent to a PM to review. The answer is stored with the request and shown on its Problem page.

## 4. Explore and the Problem page (1 min)

Open **Explore** and search `see who edited a supplier record`. This is semantic search, so the audit-trail Problem comes first without sharing its words. Then pick a status and press **Search** to filter.

Open the Problem and show:

- the statement and status
- the supporter count
- the decision area
- the update feed
- the requests behind it, anonymized to the customer's segment ("An SMB customer")

## 5. The review queue (1.5 min)

Switch to **Alex Moreno** (PM). Open **Review**.

The queue shows the oldest 25 items; each is labeled *Review grouping*, *Signals disagree* (the model and the similarity disagree) or *New problem*.

- **"Who changed this vendor's bank details?"** (*Signals disagree*: the model says same problem at similarity 0.44). Show the verdict, the rationale and the candidates with their similarity. **Accept** it: the grouping stands, and the statement may be refined.
- **"Export for our auditors"** was grouped into the bill-controls Problem, but it asks for an audit trail. **Move** it to the audit-trail Problem ("Customers in regulated industries…"). The move is an override event on the Metrics page.
- **"bills workflow"** (*New problem*, deliberately vague) founded the bill-approval Problem (2), which 18 later requests joined, so **Accept** it as new.

Mention that every move and split is an override event: the guardrail on the Metrics page.

## 6. Curating and prioritizing (2 min)

**Problem 2** (bill payment controls) has the most supporters. On its page, show:

- **Curate**: edit the statement and lock it, so the AI never rewrites it; the version history shows AI and PM authors. When two Problems turn out to be one need, **Merge** folds one into the other, counting each supporter once.
- **Scores**: Strategic fit, Urgency and Effort, each with a rationale citing requests (the links jump to them). **Override** Urgency with a reason; the AI's value stays beside it. **Rescore** keeps the override.

Open **Priorities**. Move the five weight sliders and watch the ranking change in the browser. Reach and Business value are computed from supporters and ARR; the AI scores show staleness after new evidence. Point at **Rescore all stale**.

Optionally, in **Settings**, edit the strategy: every score turns stale, and nothing rescores until the PM asks.

## 7. The decision brief (1 min)

On Problem 1, show the brief generated before recording. An agent with six read-only tools gathered:

- who is asking
- quotes
- the score breakdown
- solution options
- risks

Every claim links to its sources. A brief citing anything the tools didn't return is rejected; quotes must be copied from the request they cite.

## 8. Decide and tell customers (1.5 min)

On Problem 1, record **Planned** with a public rationale. Two drafts appear:

- a customer update, built only from the statement, the decision and the public rationale, so it can't leak ARR or account names
- an internal update with talking points for Sales and CS

Edit the customer draft and **Approve**. Switch back to Maria: **Notifications** has the update, and the Problem page shows it in its feed.

## 9. Measuring it (1 min)

Open **Metrics**. Business impact and AI quality come from the event log:

- deflection (step 2)
- missed duplicates
- hands-off groupings
- time to triaged
- time to first update (step 8)
- the override guardrail (steps 5 and 6)

Below them is the offline evaluation baseline: 53% of held-out duplicates grouped, at 77% review precision.

Mention the comparison behind the intake setup (`docs/eval-intake-setups.md`): thinking on beat a bigger model, more candidates and two prompt rewrites. Also mention the check on real vscode feature requests (README, *On real data*).

## 10. Under the hood (optional, 30 s)

In Langfuse (http://localhost:3001), each AI call is a named trace (`intake-analysis`, `scoring`, `decision-brief` with its tool calls) with prompt, output, tokens and latency.

## Close (30 s)

What it would take next:

- analyze after submission, so nobody waits 30 s
- more labeled data, to unlock confident auto-grouping
- a hosted model, which is one env change

Risks: no moderation or PII scrubbing, and prompt injection is mitigated, not solved.
