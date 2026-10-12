ALTER TYPE "public"."request_status" ADD VALUE 'analyzing' BEFORE 'submitted';--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "analysis_started_at" timestamp with time zone;