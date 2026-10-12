CREATE TYPE "public"."match_tier" AS ENUM('high', 'medium', 'low');--> statement-breakpoint
ALTER TABLE "problems" ADD COLUMN "statement_locked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "tier" "match_tier";--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "split_requested_at" timestamp with time zone;--> statement-breakpoint
-- Before grouping, every submitted request started its own Problem.
UPDATE "requests" SET "tier" = 'low' WHERE "status" = 'submitted';