import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  vector,
} from "drizzle-orm/pg-core";
import type { Brief } from "@/domain/brief";
import type { Clarification, RequestAnalysis } from "@/domain/intake";
import { JUDGED } from "@/domain/ranking";

/** Embedding vector size; every configured embedding model must produce it. */
export const EMBEDDING_DIMENSIONS = 1024;

const id = () =>
  bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity();
const refColumn = (name: string) => bigint(name, { mode: "number" });

export const segment = pgEnum("segment", ["smb", "mid_market", "enterprise"]);
export const role = pgEnum("role", ["submitter", "pm"]);
export const actor = pgEnum("actor", ["user", "pm", "ai"]);
export const problemStatus = pgEnum("problem_status", [
  "open",
  "under_review",
  "planned",
  "declined",
  "shipped",
]);
/** How sure intake was about a grouping: high attaches, medium attaches for review, low creates. */
export const matchTier = pgEnum("match_tier", ["high", "medium", "low"]);

// draft: saved but not analyzed; analyzing: a run holds it; submitted: grouped into a Problem.
export const requestStatus = pgEnum("request_status", [
  "draft",
  "analyzing",
  "submitted",
]);

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const accounts = pgTable("accounts", {
  id: id(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  segment: segment("segment").notNull(),
  arr: bigint("arr", { mode: "number" }).notNull(),
  churnRisk: boolean("churn_risk").notNull().default(false),
});

export const users = pgTable(
  "users",
  {
    id: id(),
    key: text("key").notNull().unique(),
    name: text("name").notNull(),
    role: role("role").notNull(),
    accountId: refColumn("account_id").references(() => accounts.id),
  },
  (t) => [index("users_account_id_idx").on(t.accountId)],
);

export const events = pgTable(
  "events",
  {
    id: id(),
    type: text("type").notNull(),
    actor: actor("actor").notNull(),
    actorId: refColumn("actor_id").references(() => users.id),
    entityType: text("entity_type").notNull(),
    entityId: bigint("entity_id", { mode: "number" }).notNull(),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: createdAt(),
  },
  (t) => [
    index("events_type_created_idx").on(t.type, t.createdAt),
    index("events_entity_idx").on(t.entityType, t.entityId),
    index("events_actor_id_idx").on(t.actorId),
  ],
);

// Small key/value store: matchMode, maxClarifyingQuestions, strategy document.
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
});

export const problems = pgTable("problems", {
  id: id(),
  statement: text("statement").notNull(),
  // A PM-locked statement is never rewritten by AI.
  statementLocked: boolean("statement_locked").notNull().default(false),
  status: problemStatus("status").notNull().default("open"),
  createdAt: createdAt(),
});

export const problemVersions = pgTable(
  "problem_versions",
  {
    id: id(),
    problemId: refColumn("problem_id")
      .notNull()
      .references(() => problems.id, { onDelete: "cascade" }),
    statement: text("statement").notNull(),
    author: actor("author").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("problem_versions_problem_id_idx").on(t.problemId)],
);

export const requests = pgTable(
  "requests",
  {
    id: id(),
    authorId: refColumn("author_id")
      .notNull()
      .references(() => users.id),
    // Null while the request is a draft (analysis has not succeeded yet).
    problemId: refColumn("problem_id").references(() => problems.id),
    // The submitter's words, never modified after insert.
    title: text("title").notNull(),
    description: text("description").notNull(),
    // Clarifying questions the submitter answered before submitting; skipped ones are left out.
    clarifications: jsonb("clarifications")
      .$type<Clarification[]>()
      .notNull()
      .default([]),
    status: requestStatus("status").notNull().default("draft"),
    // When the current analysis run claimed the request; old claims count as crashed runs.
    analysisStartedAt: timestamp("analysis_started_at", { withTimezone: true }),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
    embeddingModel: text("embedding_model"),
    analysis: jsonb("analysis").$type<RequestAnalysis>(),
    tier: matchTier("tier"),
    // Set when the submitter says the grouping is wrong ("Not the same? Split it out").
    splitRequestedAt: timestamp("split_requested_at", { withTimezone: true }),
    // Set when a PM accepts, moves or splits it; the review queue holds the rest it needs.
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("requests_embedding_hnsw").using(
      "hnsw",
      t.embedding.op("vector_cosine_ops"),
    ),
    index("requests_problem_id_idx").on(t.problemId),
    index("requests_author_created_idx").on(t.authorId, t.createdAt),
  ],
);

export const supports = pgTable(
  "supports",
  {
    id: id(),
    problemId: refColumn("problem_id")
      .notNull()
      .references(() => problems.id, { onDelete: "cascade" }),
    userId: refColumn("user_id")
      .notNull()
      .references(() => users.id),
    // Set when the support came from submitting a request.
    requestId: refColumn("request_id").references(() => requests.id),
    // "How does this affect you?" from a +1; evidence for the Problem.
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("supports_problem_user_idx").on(t.problemId, t.userId),
    index("supports_user_id_idx").on(t.userId),
    index("supports_request_id_idx").on(t.requestId),
  ],
);

/** What the AI judges per Problem; Reach and Business value are computed in SQL instead. */
// Named as the ranking's criteria, so no mapping is needed.
export const scoreCriterion = pgEnum("score_criterion", JUDGED);

export const scores = pgTable(
  "scores",
  {
    id: id(),
    problemId: refColumn("problem_id")
      .notNull()
      .references(() => problems.id, { onDelete: "cascade" }),
    criterion: scoreCriterion("criterion").notNull(),
    // The AI's judgement, 1 to 5, with its one-line reason and the requests it cites.
    value: integer("value").notNull(),
    rationale: text("rationale").notNull(),
    citedRequestIds: bigint("cited_request_ids", { mode: "number" })
      .array()
      .notNull(),
    // Fingerprints of the evidence and strategy the AI saw; when either changes, the score is stale.
    evidence: text("evidence").notNull(),
    strategy: text("strategy").notNull(),
    scoredAt: timestamp("scored_at", { withTimezone: true }).notNull(),
    // A PM override replaces the value in the ranking; the AI's stays beside it.
    overrideValue: integer("override_value"),
    overrideReason: text("override_reason"),
    overriddenBy: refColumn("overridden_by").references(() => users.id),
    overriddenAt: timestamp("overridden_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("scores_problem_criterion_idx").on(t.problemId, t.criterion),
    index("scores_overridden_by_idx").on(t.overriddenBy),
    check("scores_value_range", sql`${t.value} between 1 and 5`),
    check(
      "scores_override_range",
      sql`${t.overrideValue} is null or ${t.overrideValue} between 1 and 5`,
    ),
    // An override always says why.
    check(
      "scores_override_reason",
      sql`(${t.overrideValue} is null) = (${t.overrideReason} is null)`,
    ),
  ],
);

/** A PM's decision on a Problem: its new status and the rationale customers see. */
export const decisions = pgTable(
  "decisions",
  {
    id: id(),
    problemId: refColumn("problem_id")
      .notNull()
      .references(() => problems.id, { onDelete: "cascade" }),
    status: problemStatus("status").notNull(),
    rationale: text("rationale").notNull(),
    decidedBy: refColumn("decided_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("decisions_problem_id_idx").on(t.problemId),
    index("decisions_decided_by_idx").on(t.decidedBy),
    check("decisions_decided_status", sql`${t.status} <> 'open'`),
  ],
);

/** customer: for supporters, built from public facts only. internal: for Sales and CS. */
export const updateAudience = pgEnum("update_audience", [
  "customer",
  "internal",
]);

/** An AI-drafted update on a decision; nothing goes out until a PM approves it. */
export const updates = pgTable(
  "updates",
  {
    id: id(),
    decisionId: refColumn("decision_id")
      .notNull()
      .references(() => decisions.id, { onDelete: "cascade" }),
    audience: updateAudience("audience").notNull(),
    body: text("body").notNull(),
    approvedBy: refColumn("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("updates_decision_id_idx").on(t.decisionId),
    index("updates_approved_by_idx").on(t.approvedBy),
  ],
);

/** An approved customer update, delivered in-app to one supporter. */
export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    userId: refColumn("user_id")
      .notNull()
      .references(() => users.id),
    updateId: refColumn("update_id")
      .notNull()
      .references(() => updates.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("notifications_user_update_idx").on(t.userId, t.updateId),
    index("notifications_update_id_idx").on(t.updateId),
  ],
);

/** A decision brief the agent gathered for a PM; its claims cite the sources it read. */
export const briefs = pgTable(
  "briefs",
  {
    id: id(),
    problemId: refColumn("problem_id")
      .notNull()
      .references(() => problems.id, { onDelete: "cascade" }),
    content: jsonb("content").$type<Brief>().notNull(),
    requestedBy: refColumn("requested_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("briefs_problem_id_idx").on(t.problemId),
    index("briefs_requested_by_idx").on(t.requestedBy),
  ],
);
