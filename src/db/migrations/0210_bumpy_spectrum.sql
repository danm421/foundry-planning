CREATE TYPE "public"."plan_observation_owner" AS ENUM('advisor', 'client', 'joint');--> statement-breakpoint
CREATE TYPE "public"."plan_observation_section" AS ENUM('observation', 'next_step');--> statement-breakpoint
CREATE TYPE "public"."plan_observation_source" AS ENUM('manual', 'ai');--> statement-breakpoint
CREATE TYPE "public"."plan_observation_status" AS ENUM('open', 'in_progress', 'done');--> statement-breakpoint
CREATE TYPE "public"."plan_observation_topic" AS ENUM('retirement', 'cash-flow', 'investments', 'tax', 'insurance', 'estate', 'education', 'general');--> statement-breakpoint
CREATE TABLE "plan_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"section" "plan_observation_section" NOT NULL,
	"topic" "plan_observation_topic" DEFAULT 'general' NOT NULL,
	"title" text,
	"body" text NOT NULL,
	"status" "plan_observation_status" DEFAULT 'open' NOT NULL,
	"owner" "plan_observation_owner",
	"priority" "open_item_priority",
	"target_date" date,
	"completed_at" timestamp,
	"source" "plan_observation_source" DEFAULT 'manual' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plan_observations" ADD CONSTRAINT "plan_observations_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plan_observations_client_section_idx" ON "plan_observations" USING btree ("client_id","section","sort_order");