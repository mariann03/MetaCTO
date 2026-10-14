CREATE TYPE "public"."score_criterion" AS ENUM('strategicFit', 'urgency', 'effort');--> statement-breakpoint
CREATE TABLE "scores" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "scores_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"problem_id" bigint NOT NULL,
	"criterion" "score_criterion" NOT NULL,
	"value" integer NOT NULL,
	"rationale" text NOT NULL,
	"cited_request_ids" bigint[] NOT NULL,
	"evidence" text NOT NULL,
	"strategy" text NOT NULL,
	"scored_at" timestamp with time zone NOT NULL,
	"override_value" integer,
	"override_reason" text,
	"overridden_by" bigint,
	"overridden_at" timestamp with time zone,
	CONSTRAINT "scores_value_range" CHECK ("scores"."value" between 1 and 5),
	CONSTRAINT "scores_override_range" CHECK ("scores"."override_value" is null or "scores"."override_value" between 1 and 5),
	CONSTRAINT "scores_override_reason" CHECK (("scores"."override_value" is null) = ("scores"."override_reason" is null))
);
--> statement-breakpoint
ALTER TABLE "scores" ADD CONSTRAINT "scores_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scores" ADD CONSTRAINT "scores_overridden_by_users_id_fk" FOREIGN KEY ("overridden_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "scores_problem_criterion_idx" ON "scores" USING btree ("problem_id","criterion");--> statement-breakpoint
CREATE INDEX "scores_overridden_by_idx" ON "scores" USING btree ("overridden_by");