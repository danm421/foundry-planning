CREATE TYPE "public"."charity_type" AS ENUM('public', 'private');--> statement-breakpoint
ALTER TABLE "external_beneficiaries" ADD COLUMN "charity_type" charity_type DEFAULT 'public' NOT NULL;
--> statement-breakpoint
-- Plan 3a — exactly-one-of recipient kind on gifts
ALTER TABLE "gifts" ADD CONSTRAINT "gifts_recipient_kind" CHECK (
  ("recipient_entity_id" IS NOT NULL)::int +
  ("recipient_family_member_id" IS NOT NULL)::int +
  ("recipient_external_beneficiary_id" IS NOT NULL)::int = 1
);
--> statement-breakpoint
-- Indexes on the non-entity recipient FKs
CREATE INDEX "gifts_recipient_family_member_year_idx"
  ON "gifts" ("recipient_family_member_id", "year")
  WHERE "recipient_family_member_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "gifts_recipient_external_beneficiary_year_idx"
  ON "gifts" ("recipient_external_beneficiary_id", "year")
  WHERE "recipient_external_beneficiary_id" IS NOT NULL;
--> statement-breakpoint
-- Verification: every existing gifts row passes the new CHECK before commit.
DO $$
DECLARE
  bad_rows INT;
BEGIN
  SELECT COUNT(*) INTO bad_rows
  FROM "gifts"
  WHERE NOT (
    ("recipient_entity_id" IS NOT NULL)::int +
    ("recipient_family_member_id" IS NOT NULL)::int +
    ("recipient_external_beneficiary_id" IS NOT NULL)::int = 1
  );
  IF bad_rows > 0 THEN
    RAISE EXCEPTION 'Migration 0058 verification failed: % gifts row(s) violate gifts_recipient_kind. Aborting.', bad_rows;
  END IF;
END $$;