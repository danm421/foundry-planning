CREATE TYPE "public"."entity_flow_mode" AS ENUM('annual', 'schedule');--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "flow_mode" "entity_flow_mode" DEFAULT 'annual' NOT NULL;