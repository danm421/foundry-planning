CREATE TYPE "public"."entity_tax_treatment" AS ENUM('qbi', 'ordinary', 'non_taxable');--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "tax_treatment" "entity_tax_treatment" DEFAULT 'ordinary' NOT NULL;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "distribution_policy_percent" numeric(5, 4);