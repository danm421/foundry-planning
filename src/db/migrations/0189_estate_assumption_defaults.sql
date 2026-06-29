ALTER TABLE "plan_settings" ALTER COLUMN "ird_tax_rate" SET DEFAULT '0.3500';--> statement-breakpoint
ALTER TABLE "plan_settings" ALTER COLUMN "probate_cost_rate" SET DEFAULT '0.0200';--> statement-breakpoint
-- Back-fill existing plans that still carry the old 0% default up to the new
-- defaults (IRD 35%, probate 2%). Rows with a custom non-zero rate are left
-- untouched — only the previously-defaulted 0 values are bumped.
UPDATE "plan_settings" SET "ird_tax_rate" = '0.3500' WHERE "ird_tax_rate" = 0;--> statement-breakpoint
UPDATE "plan_settings" SET "probate_cost_rate" = '0.0200' WHERE "probate_cost_rate" = 0;
