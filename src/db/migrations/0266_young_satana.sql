ALTER TABLE "client_import_extractions" ADD COLUMN "total_tokens" integer;--> statement-breakpoint
ALTER TABLE "client_import_extractions" ADD COLUMN "usage_json" jsonb;