ALTER TYPE "public"."beneficiary_tier" ADD VALUE 'income';--> statement-breakpoint
ALTER TYPE "public"."beneficiary_tier" ADD VALUE 'remainder';--> statement-breakpoint
CREATE TYPE "public"."household_role" AS ENUM('client', 'spouse');--> statement-breakpoint
CREATE TYPE "public"."trust_ends" AS ENUM('client_death', 'spouse_death', 'survivorship');--> statement-breakpoint
ALTER TABLE "beneficiary_designations" ADD COLUMN "entity_id_ref" uuid;--> statement-breakpoint
ALTER TABLE "beneficiary_designations" ADD COLUMN "household_role" "household_role";--> statement-breakpoint
ALTER TABLE "beneficiary_designations" ADD CONSTRAINT "beneficiary_designations_entity_id_ref_entities_id_fk" FOREIGN KEY ("entity_id_ref") REFERENCES "public"."entities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "trust_ends" "trust_ends";--> statement-breakpoint
-- Data fold step A: re-tier existing trust designations from primary/contingent
-- to income/remainder (the new semantic for entity-scoped designations).
UPDATE "beneficiary_designations"
SET "tier" = 'income'
WHERE "tier" = 'primary' AND "entity_id" IS NOT NULL;--> statement-breakpoint
UPDATE "beneficiary_designations"
SET "tier" = 'remainder'
WHERE "tier" = 'contingent' AND "entity_id" IS NOT NULL;--> statement-breakpoint
-- Data fold step B: promote legacy single-FK income beneficiaries on entities
-- (income_beneficiary_family_member_id / income_beneficiary_external_id) into
-- the beneficiary_designations table as 100% income-tier rows.
INSERT INTO "beneficiary_designations" (
  "id", "client_id", "target_kind", "account_id", "entity_id", "tier",
  "family_member_id", "external_beneficiary_id", "percentage", "sort_order"
)
SELECT
  gen_random_uuid(),
  e."client_id",
  'trust',
  NULL,
  e."id",
  'income',
  e."income_beneficiary_family_member_id",
  e."income_beneficiary_external_id",
  100,
  0
FROM "entities" e
WHERE e."entity_type" = 'trust'
  AND (e."income_beneficiary_family_member_id" IS NOT NULL OR e."income_beneficiary_external_id" IS NOT NULL)
  AND NOT EXISTS (
    SELECT 1 FROM "beneficiary_designations" bd
    WHERE bd."entity_id" = e."id" AND bd."tier" = 'income'
  );--> statement-breakpoint
-- Data fold step C: fold per-trust exemption_consumed rollup into the gifts
-- ledger as a single opening-balance row per trust. Year is taken from the
-- trust's created_at; grantor falls back to 'client' when null.
INSERT INTO "gifts" (
  "id", "client_id", "year", "amount", "grantor", "recipient_entity_id",
  "use_crummey_powers", "notes"
)
SELECT
  gen_random_uuid(),
  e."client_id",
  EXTRACT(YEAR FROM e."created_at")::int,
  e."exemption_consumed",
  COALESCE(e."grantor"::text, 'client')::"owner",
  e."id",
  FALSE,
  'Pre-tracking exemption opening balance (migrated 2026-04-26)'
FROM "entities" e
WHERE e."entity_type" = 'trust'
  AND e."exemption_consumed" IS NOT NULL
  AND e."exemption_consumed"::numeric > 0;--> statement-breakpoint
ALTER TABLE "entities" DROP CONSTRAINT "entities_income_beneficiary_family_member_id_family_members_id_fk";--> statement-breakpoint
ALTER TABLE "entities" DROP CONSTRAINT "entities_income_beneficiary_external_id_external_beneficiaries_id_fk";--> statement-breakpoint
ALTER TABLE "entities" DROP COLUMN "exemption_consumed";--> statement-breakpoint
ALTER TABLE "entities" DROP COLUMN "income_beneficiary_family_member_id";--> statement-breakpoint
ALTER TABLE "entities" DROP COLUMN "income_beneficiary_external_id";--> statement-breakpoint
-- Replace the existing 2-way XOR (family_member_id ⊕ external_beneficiary_id)
-- with a 4-way XOR that also covers the new entity_id_ref and household_role
-- named-beneficiary slots. Exactly one of the four must be set per row.
ALTER TABLE "beneficiary_designations" DROP CONSTRAINT IF EXISTS "beneficiary_designations_beneficiary_exactly_one";--> statement-breakpoint
ALTER TABLE "beneficiary_designations" ADD CONSTRAINT "beneficiary_designations_beneficiary_exactly_one" CHECK (
  (CASE WHEN "family_member_id" IS NOT NULL THEN 1 ELSE 0 END)
  + (CASE WHEN "external_beneficiary_id" IS NOT NULL THEN 1 ELSE 0 END)
  + (CASE WHEN "entity_id_ref" IS NOT NULL THEN 1 ELSE 0 END)
  + (CASE WHEN "household_role" IS NOT NULL THEN 1 ELSE 0 END)
  = 1
);
