ALTER TABLE "clients" ADD COLUMN "portal_investments_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "portal_budget_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "portal_documents_enabled" boolean DEFAULT true NOT NULL;