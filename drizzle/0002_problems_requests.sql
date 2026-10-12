CREATE TYPE "public"."problem_status" AS ENUM('open', 'under_review', 'planned', 'declined', 'shipped');--> statement-breakpoint
CREATE TYPE "public"."request_status" AS ENUM('draft', 'submitted');--> statement-breakpoint
CREATE TABLE "problem_versions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "problem_versions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"problem_id" bigint NOT NULL,
	"statement" text NOT NULL,
	"author" "actor" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "problems" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "problems_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"statement" text NOT NULL,
	"status" "problem_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requests" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "requests_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"author_id" bigint NOT NULL,
	"problem_id" bigint,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"status" "request_status" DEFAULT 'draft' NOT NULL,
	"embedding" vector(1024),
	"embedding_model" text,
	"analysis" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supports" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "supports_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"problem_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"request_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "problem_versions" ADD CONSTRAINT "problem_versions_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supports" ADD CONSTRAINT "supports_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supports" ADD CONSTRAINT "supports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supports" ADD CONSTRAINT "supports_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "problem_versions_problem_id_idx" ON "problem_versions" USING btree ("problem_id");--> statement-breakpoint
CREATE INDEX "requests_embedding_hnsw" ON "requests" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "requests_problem_id_idx" ON "requests" USING btree ("problem_id");--> statement-breakpoint
CREATE INDEX "requests_author_created_idx" ON "requests" USING btree ("author_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "supports_problem_user_idx" ON "supports" USING btree ("problem_id","user_id");--> statement-breakpoint
CREATE INDEX "supports_user_id_idx" ON "supports" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "supports_request_id_idx" ON "supports" USING btree ("request_id");