-- Add tax_engine_mode toggle and two optional inflation overrides to plan_settings.
-- tax_engine_mode defaults to 'flat' so existing clients keep current behavior.
-- tax_inflation_rate and ss_wage_growth_rate are nullable; engine falls back to
-- the general inflation_rate when not set.

CREATE TYPE "public"."tax_engine_mode" AS ENUM('flat', 'bracket');
--> statement-breakpoint

ALTER TABLE "plan_settings"
  ADD COLUMN "tax_engine_mode" "tax_engine_mode" DEFAULT 'flat' NOT NULL;
--> statement-breakpoint

ALTER TABLE "plan_settings"
  ADD COLUMN "tax_inflation_rate" numeric(5, 4);
--> statement-breakpoint

ALTER TABLE "plan_settings"
  ADD COLUMN "ss_wage_growth_rate" numeric(5, 4);
