-- Data-only migration. Bring the Social Security rows seeded by
-- `lib/clients/create-client.ts` onto the product default the seed now writes:
-- a PIA off the SSA statement, claimed at full retirement age.
--
-- Before this, the seed left both mode columns NULL, and every reader has a
-- different fallback for a NULL: `ss_benefit_mode` reads as "manual_amount"
-- (social-security-card / social-security-dialog / household-map/goals.ts) and
-- `claiming_age_mode` reads as "years" (engine/socialSecurity/claimAge.ts). So an
-- untouched household opened on "Annual benefit amount · 67y 0mo" on the Details
-- tab and in the Guided Walkthrough.
--
-- PROJECTION-NEUTRAL BY CONSTRUCTION, which is what the WHERE clause buys. Only
-- rows that pay nothing either way are touched: `pia_monthly IS NULL` means
-- engine/income.ts skips the `pia_at_fra` branch (it requires a non-null PIA) and
-- falls through to the amount path, where `annual_amount = 0` pays zero — exactly
-- what the row paid before. The claim age is moot on a zero benefit.
--
-- Rows carrying a real choice are excluded by the same clause: an advisor's
-- annual amount (`annual_amount <> 0`), an imported or entered PIA
-- (`pia_monthly IS NOT NULL`), and anything that already stores either mode.
UPDATE "incomes"
SET "ss_benefit_mode" = 'pia_at_fra',
    "claiming_age_mode" = 'fra'
WHERE "type" = 'social_security'
  AND "ss_benefit_mode" IS NULL
  AND "claiming_age_mode" IS NULL
  AND "pia_monthly" IS NULL
  AND COALESCE("annual_amount", 0) = 0;
