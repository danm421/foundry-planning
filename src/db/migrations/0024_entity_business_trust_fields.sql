ALTER TABLE "entities" ADD COLUMN "value" numeric(15, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "owner" "owner";--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "grantors" jsonb;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "beneficiaries" jsonb;