ALTER TABLE "savings_rules" ADD COLUMN "annual_percent" numeric(6, 4);--> statement-breakpoint
ALTER TABLE "savings_rules" ADD COLUMN "is_deductible" boolean DEFAULT true NOT NULL;--> statement-breakpoint
-- Backfill: existing rules on "other" retirement accounts should NOT start
-- deducting. The column default is true (correct for traditional_ira / 401k / 403b
-- rules that already deduct), but the UI default for "other" retirement is unchecked.
UPDATE "savings_rules"
SET "is_deductible" = false
WHERE "account_id" IN (
  SELECT "id" FROM "accounts" WHERE "sub_type" = 'other' AND "category" = 'retirement'
);
