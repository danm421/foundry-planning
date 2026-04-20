-- Default checking account — every client has exactly one "household cash" account that
-- incomes are paid into and expenses/savings are drawn from. When the balance goes
-- negative, the engine pulls from the withdrawal strategy to cover it; if the portfolio
-- is exhausted, the balance continues to go negative.

ALTER TABLE "accounts" ADD COLUMN "is_default_checking" boolean NOT NULL DEFAULT false;

-- At most one default checking per (client, scenario).
CREATE UNIQUE INDEX "accounts_default_checking_per_scenario"
  ON "accounts" ("client_id", "scenario_id")
  WHERE "is_default_checking" = true;

-- Backfill: for every existing (client, scenario) pair that lacks a default checking,
-- create one. Its starting balance is zero and its growth rate inherits the category
-- default from plan_settings (null means "use default").
INSERT INTO "accounts" (
  "client_id",
  "scenario_id",
  "name",
  "category",
  "sub_type",
  "owner",
  "value",
  "basis",
  "growth_rate",
  "rmd_enabled",
  "source",
  "is_default_checking"
)
SELECT
  s."client_id",
  s."id",
  'Household Cash',
  'cash'::account_category,
  'checking'::account_sub_type,
  'joint'::owner,
  '0',
  '0',
  NULL,
  false,
  'manual'::source,
  true
FROM "scenarios" s
WHERE NOT EXISTS (
  SELECT 1
  FROM "accounts" a
  WHERE a."client_id" = s."client_id"
    AND a."scenario_id" = s."id"
    AND a."is_default_checking" = true
);
