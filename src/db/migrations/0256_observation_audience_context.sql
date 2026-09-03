CREATE TYPE "public"."plan_observation_audience" AS ENUM('client', 'advisor');--> statement-breakpoint
CREATE TABLE "plan_observation_context" (
	"client_id" uuid PRIMARY KEY NOT NULL,
	"observations_context" text DEFAULT '' NOT NULL,
	"next_steps_context" text DEFAULT '' NOT NULL,
	"next_steps_scenario_id" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plan_observations" ADD COLUMN "audience" "plan_observation_audience" DEFAULT 'client' NOT NULL;--> statement-breakpoint
ALTER TABLE "plan_observations" ADD COLUMN "source_scenario_id" text;--> statement-breakpoint
ALTER TABLE "plan_observation_context" ADD CONSTRAINT "plan_observation_context_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;