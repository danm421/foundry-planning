CREATE TYPE "public"."inflation_rate_source" AS ENUM('asset_class', 'custom');--> statement-breakpoint
CREATE TYPE "public"."item_growth_source" AS ENUM('custom', 'inflation');--> statement-breakpoint
ALTER TYPE "public"."growth_source" ADD VALUE 'inflation';--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "growth_source" "item_growth_source" DEFAULT 'custom' NOT NULL;--> statement-breakpoint
ALTER TABLE "incomes" ADD COLUMN "growth_source" "item_growth_source" DEFAULT 'custom' NOT NULL;--> statement-breakpoint
ALTER TABLE "plan_settings" ADD COLUMN "inflation_rate_source" "inflation_rate_source" DEFAULT 'asset_class' NOT NULL;--> statement-breakpoint
ALTER TABLE "savings_rules" ADD COLUMN "growth_rate" numeric(5, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "savings_rules" ADD COLUMN "growth_source" "item_growth_source" DEFAULT 'custom' NOT NULL;