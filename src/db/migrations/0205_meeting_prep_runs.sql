ALTER TABLE "generation_runs" ALTER COLUMN "client_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "generation_runs" ADD COLUMN "result_payload" jsonb;