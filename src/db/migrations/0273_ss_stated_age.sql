ALTER TABLE "incomes" ADD COLUMN "ss_stated_age" integer;--> statement-breakpoint
ALTER TABLE "incomes" ADD COLUMN "ss_stated_age_months" integer;--> statement-breakpoint
ALTER TABLE "incomes" ADD COLUMN "ss_amount_unit" text;--> statement-breakpoint
-- Pin every stated-amount Social Security row claimed at a SPECIFIC AGE to that
-- age, so a later claim-age change reduces/credits the benefit instead of
-- carrying the amount along. Own benefit is unchanged: amount quoted at the
-- claim age round-trips exactly.
UPDATE "incomes"
SET "ss_stated_age" = "claiming_age",
    "ss_stated_age_months" = COALESCE("claiming_age_months", 0),
    "ss_amount_unit" = 'annual'
WHERE "type" = 'social_security'
  AND COALESCE("ss_benefit_mode", 'manual_amount') = 'manual_amount'
  AND "claiming_age" IS NOT NULL
  AND COALESCE("claiming_age_mode", 'years') = 'years';
--> statement-breakpoint
-- A stated amount claimed AT FULL RETIREMENT AGE is, by definition, the PIA.
-- Convert it outright (no DOB arithmetic in SQL). Rounded to cents: own benefit
-- moves by at most $0.06 a year.
UPDATE "incomes"
SET "ss_benefit_mode" = 'pia_at_fra',
    "pia_monthly" = ROUND("annual_amount" / 12, 2),
    "ss_amount_unit" = 'annual'
WHERE "type" = 'social_security'
  AND COALESCE("ss_benefit_mode", 'manual_amount') = 'manual_amount'
  AND "claiming_age" IS NOT NULL
  AND "claiming_age_mode" = 'fra';
