ALTER TABLE "plan_settings" ADD COLUMN "growth_source_real_estate" "growth_source" DEFAULT 'inflation' NOT NULL;--> statement-breakpoint
ALTER TABLE "plan_settings" ADD COLUMN "growth_source_business" "growth_source" DEFAULT 'inflation' NOT NULL;--> statement-breakpoint
ALTER TABLE "plan_settings" ADD COLUMN "growth_source_life_insurance" "growth_source" DEFAULT 'inflation' NOT NULL;