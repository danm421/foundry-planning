-- Each entity (trust, LLC, etc.) gets its own default checking account that collects
-- the entity's incomes, pays its expenses and liability payments, and receives RMD
-- distributions from its retirement accounts. The household still has its own default
-- checking; uniqueness is now per-(client, scenario, owner_entity_id) rather than
-- per-(client, scenario).

-- Drop the old household-only uniqueness constraint.
DROP INDEX IF EXISTS "accounts_default_checking_per_scenario";

-- Recreate it keyed on owner_entity_id as well. NULL owner_entity_id represents the
-- household bucket; we treat it as a sentinel UUID via COALESCE so NULL rows collide
-- with each other the way we want.
CREATE UNIQUE INDEX "accounts_default_checking_per_scenario_entity"
  ON "accounts" (
    "client_id",
    "scenario_id",
    COALESCE("owner_entity_id", '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE "is_default_checking" = true;

-- Backfill: for every existing entity that lacks a default checking, create one.
-- Entities aren't tied to a specific scenario, so we fan out across every scenario
-- belonging to the entity's client.
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
  "is_default_checking",
  "owner_entity_id"
)
SELECT
  e."client_id",
  s."id",
  e."name" || ' — Cash',
  'cash'::account_category,
  'checking'::account_sub_type,
  'joint'::owner,
  '0',
  '0',
  NULL,
  false,
  'manual'::source,
  true,
  e."id"
FROM "entities" e
JOIN "scenarios" s ON s."client_id" = e."client_id"
WHERE NOT EXISTS (
  SELECT 1
  FROM "accounts" a
  WHERE a."client_id" = e."client_id"
    AND a."scenario_id" = s."id"
    AND a."owner_entity_id" = e."id"
    AND a."is_default_checking" = true
);
