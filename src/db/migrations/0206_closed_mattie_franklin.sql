CREATE TYPE "public"."compliance_export_batch_status" AS ENUM('queued', 'running', 'done', 'done_with_errors', 'failed');--> statement-breakpoint
CREATE TABLE "compliance_export_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" text NOT NULL,
	"status" "compliance_export_batch_status" DEFAULT 'queued' NOT NULL,
	"triggered_by" text,
	"triggered_by_email" text,
	"total_clients" integer DEFAULT 0 NOT NULL,
	"deck_spec" jsonb,
	"skipped_clients" jsonb,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"finished_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "generation_runs" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
CREATE INDEX "compliance_export_batches_firm_idx" ON "compliance_export_batches" USING btree ("firm_id","created_at");--> statement-breakpoint
CREATE INDEX "compliance_export_batches_status_idx" ON "compliance_export_batches" USING btree ("status");--> statement-breakpoint
ALTER TABLE "generation_runs" ADD CONSTRAINT "generation_runs_batch_id_compliance_export_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."compliance_export_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "generation_runs_batch_idx" ON "generation_runs" USING btree ("batch_id","status");