CREATE TYPE "public"."details_view_mode" AS ENUM('detailed', 'map');--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "details_view_mode" "details_view_mode" DEFAULT 'detailed' NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "is_goal" boolean DEFAULT false NOT NULL;