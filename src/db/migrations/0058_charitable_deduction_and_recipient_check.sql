BEGIN;
--> statement-breakpoint
CREATE TYPE "public"."charity_type" AS ENUM('public', 'private');--> statement-breakpoint
ALTER TABLE "external_beneficiaries" ADD COLUMN "charity_type" charity_type DEFAULT 'public' NOT NULL;--> statement-breakpoint
-- Plan 3a — partial indexes for non-entity recipient lookups (CHECK already enforced by gifts_recipient_exactly_one in 0040)
CREATE INDEX "gifts_recipient_family_member_year_idx"
  ON "gifts" USING btree ("recipient_family_member_id", "year")
  WHERE "recipient_family_member_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "gifts_recipient_external_beneficiary_year_idx"
  ON "gifts" USING btree ("recipient_external_beneficiary_id", "year")
  WHERE "recipient_external_beneficiary_id" IS NOT NULL;--> statement-breakpoint
COMMIT;
