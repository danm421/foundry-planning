-- Fix #6: default new clients' investable category growth sources to "inflation"
-- instead of "custom". The enum already allows "inflation"; this only shifts the
-- column default so newly-inserted plan_settings rows pick it up. Existing rows
-- keep whatever source the advisor already chose.

ALTER TABLE "plan_settings" ALTER COLUMN "growth_source_taxable" SET DEFAULT 'inflation';
ALTER TABLE "plan_settings" ALTER COLUMN "growth_source_cash" SET DEFAULT 'inflation';
ALTER TABLE "plan_settings" ALTER COLUMN "growth_source_retirement" SET DEFAULT 'inflation';
