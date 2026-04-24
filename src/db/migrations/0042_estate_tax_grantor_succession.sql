-- Plan settings: estate admin expenses + flat state estate tax rate.
ALTER TABLE "plan_settings"
  ADD COLUMN "estate_admin_expenses" numeric(15, 2) NOT NULL DEFAULT '0',
  ADD COLUMN "flat_state_estate_rate" numeric(5, 4) NOT NULL DEFAULT '0';

--> statement-breakpoint

-- Single-grantor-per-trust simplification. Purpose-built enum — owner_enum
-- would have let 'joint' sneak in and break the single-grantor invariant.
CREATE TYPE "entity_grantor_enum" AS ENUM ('client', 'spouse');

--> statement-breakpoint

ALTER TABLE "entities"
  ADD COLUMN "grantor" "entity_grantor_enum";

--> statement-breakpoint

-- Pre-production data fix-up: map any existing grantors[0].name entry to
-- 'client' / 'spouse' via name match; leave NULL otherwise (third-party).
UPDATE "entities"
  SET "grantor" = CASE
    WHEN jsonb_array_length("grantors") >= 1
         AND (("grantors" -> 0 ->> 'name') = (
           SELECT "first_name" FROM "clients" WHERE "clients"."id" = "entities"."client_id"
         )) THEN 'client'::entity_grantor_enum
    WHEN jsonb_array_length("grantors") >= 1
         AND (("grantors" -> 0 ->> 'name') = (
           SELECT "spouse_name" FROM "clients" WHERE "clients"."id" = "entities"."client_id"
         )) THEN 'spouse'::entity_grantor_enum
    ELSE NULL
  END
WHERE "grantors" IS NOT NULL AND jsonb_array_length("grantors") >= 1;

--> statement-breakpoint

ALTER TABLE "entities" DROP COLUMN "grantors";
