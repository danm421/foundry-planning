ALTER TYPE "public"."will_recipient_kind" ADD VALUE 'other_heirs';--> statement-breakpoint
ALTER TABLE "beneficiary_designations" ADD COLUMN "other_heirs" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "beneficiary_designations" DROP CONSTRAINT "beneficiary_designations_beneficiary_exactly_one";--> statement-breakpoint
ALTER TABLE "beneficiary_designations" ADD CONSTRAINT "beneficiary_designations_beneficiary_exactly_one" CHECK (
  (CASE WHEN "family_member_id" IS NOT NULL THEN 1 ELSE 0 END)
  + (CASE WHEN "external_beneficiary_id" IS NOT NULL THEN 1 ELSE 0 END)
  + (CASE WHEN "entity_id_ref" IS NOT NULL THEN 1 ELSE 0 END)
  + (CASE WHEN "household_role" IS NOT NULL THEN 1 ELSE 0 END)
  + (CASE WHEN "other_heirs" THEN 1 ELSE 0 END)
  = 1
);--> statement-breakpoint
ALTER TABLE "will_bequest_recipients" DROP CONSTRAINT "will_bequest_recipients_kind_id_coupling";--> statement-breakpoint
ALTER TABLE "will_bequest_recipients" ADD CONSTRAINT "will_bequest_recipients_kind_id_coupling" CHECK (
  ("recipient_kind"::text IN ('spouse', 'other_heirs') AND "recipient_id" IS NULL)
  OR ("recipient_kind"::text NOT IN ('spouse', 'other_heirs') AND "recipient_id" IS NOT NULL)
);
