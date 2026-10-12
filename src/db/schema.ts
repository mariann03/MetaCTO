import {
  bigint,
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  vector,
} from "drizzle-orm/pg-core";
import type { RequestAnalysis } from "@/domain/intake";

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
    status: requestStatus("status").notNull().default("draft"),
    // When the current analysis run claimed the request; old claims count as crashed runs.
    analysisStartedAt: timestamp("analysis_started_at", { withTimezone: true }),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
    embeddingModel: text("embedding_model"),
    analysis: jsonb("analysis").$type<RequestAnalysis>(),
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
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("supports_problem_user_idx").on(t.problemId, t.userId),
    index("supports_user_id_idx").on(t.userId),
    index("supports_request_id_idx").on(t.requestId),
  ],
);
