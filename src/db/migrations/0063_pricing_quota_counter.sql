ALTER TABLE "client_imports" ADD COLUMN "ai_import_counted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "firms" ADD COLUMN "ai_imports_used" integer DEFAULT 0 NOT NULL;