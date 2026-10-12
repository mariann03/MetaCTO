import {
  bigint,
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

const id = () =>
  bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity();
const refColumn = (name: string) => bigint(name, { mode: "number" });

export const segment = pgEnum("segment", ["smb", "mid_market", "enterprise"]);
export const role = pgEnum("role", ["submitter", "pm"]);
export const actor = pgEnum("actor", ["user", "pm", "ai"]);

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
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
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
