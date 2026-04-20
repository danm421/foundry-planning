-- Enums for new tables
CREATE TYPE "entity_type" AS ENUM ('trust', 'llc', 's_corp', 'c_corp', 'partnership', 'foundation', 'other');
CREATE TYPE "family_relationship" AS ENUM ('child', 'grandchild', 'parent', 'sibling', 'other');

-- Plan settings: default growth rates per account category
ALTER TABLE "plan_settings" ADD COLUMN "default_growth_taxable" numeric(5, 4) NOT NULL DEFAULT '0.07';
ALTER TABLE "plan_settings" ADD COLUMN "default_growth_cash" numeric(5, 4) NOT NULL DEFAULT '0.02';
ALTER TABLE "plan_settings" ADD COLUMN "default_growth_retirement" numeric(5, 4) NOT NULL DEFAULT '0.07';
ALTER TABLE "plan_settings" ADD COLUMN "default_growth_real_estate" numeric(5, 4) NOT NULL DEFAULT '0.04';
ALTER TABLE "plan_settings" ADD COLUMN "default_growth_business" numeric(5, 4) NOT NULL DEFAULT '0.05';
ALTER TABLE "plan_settings" ADD COLUMN "default_growth_life_insurance" numeric(5, 4) NOT NULL DEFAULT '0.03';

-- New: entities (trusts, LLCs, etc. that can own assets)
CREATE TABLE "entities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_id" uuid NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "entity_type" "entity_type" NOT NULL DEFAULT 'trust',
  "notes" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- New: family members (children, grandchildren, parents, etc.)
CREATE TABLE "family_members" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_id" uuid NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
  "first_name" text NOT NULL,
  "last_name" text,
  "relationship" "family_relationship" NOT NULL DEFAULT 'child',
  "date_of_birth" date,
  "notes" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- Accounts: make growth_rate nullable (null = inherit the default for this category)
ALTER TABLE "accounts" ALTER COLUMN "growth_rate" DROP NOT NULL;
ALTER TABLE "accounts" ALTER COLUMN "growth_rate" DROP DEFAULT;

-- Accounts: owner_entity_id FK (null = owned by an individual via the owner enum)
ALTER TABLE "accounts" ADD COLUMN "owner_entity_id" uuid REFERENCES "entities"("id") ON DELETE SET NULL;
