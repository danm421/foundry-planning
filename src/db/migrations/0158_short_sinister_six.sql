CREATE TYPE "public"."generation_run_status" AS ENUM('queued', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TABLE "generation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"firm_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" "generation_run_status" DEFAULT 'queued' NOT NULL,
	"triggered_by" text,
	"triggered_by_email" text,
	"scenario_id" uuid,
	"request_payload" jsonb,
	"result_document_id" uuid,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"finished_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "generation_runs" ADD CONSTRAINT "generation_runs_household_id_crm_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."crm_households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_runs" ADD CONSTRAINT "generation_runs_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_runs" ADD CONSTRAINT "generation_runs_scenario_id_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."scenarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_runs" ADD CONSTRAINT "generation_runs_result_document_id_crm_household_documents_id_fk" FOREIGN KEY ("result_document_id") REFERENCES "public"."crm_household_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "generation_runs_household_idx" ON "generation_runs" USING btree ("household_id","created_at");--> statement-breakpoint
CREATE INDEX "generation_runs_status_idx" ON "generation_runs" USING btree ("status","created_at");