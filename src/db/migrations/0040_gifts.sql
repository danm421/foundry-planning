CREATE TABLE "gifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"grantor" "owner" NOT NULL,
	"recipient_entity_id" uuid,
	"recipient_family_member_id" uuid,
	"recipient_external_beneficiary_id" uuid,
	"use_crummey_powers" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tax_year_parameters" ADD COLUMN "gift_annual_exclusion" numeric(10, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "gifts" ADD CONSTRAINT "gifts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gifts" ADD CONSTRAINT "gifts_recipient_entity_id_entities_id_fk" FOREIGN KEY ("recipient_entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gifts" ADD CONSTRAINT "gifts_recipient_family_member_id_family_members_id_fk" FOREIGN KEY ("recipient_family_member_id") REFERENCES "public"."family_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gifts" ADD CONSTRAINT "gifts_recipient_external_beneficiary_id_external_beneficiaries_id_fk" FOREIGN KEY ("recipient_external_beneficiary_id") REFERENCES "public"."external_beneficiaries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gifts_client_year_idx" ON "gifts" USING btree ("client_id","year");--> statement-breakpoint
CREATE INDEX "gifts_client_grantor_year_idx" ON "gifts" USING btree ("client_id","grantor","year");--> statement-breakpoint
ALTER TABLE "gifts"
  ADD CONSTRAINT "gifts_recipient_exactly_one" CHECK (
    (recipient_entity_id IS NOT NULL AND recipient_family_member_id IS NULL AND recipient_external_beneficiary_id IS NULL) OR
    (recipient_entity_id IS NULL AND recipient_family_member_id IS NOT NULL AND recipient_external_beneficiary_id IS NULL) OR
    (recipient_entity_id IS NULL AND recipient_family_member_id IS NULL AND recipient_external_beneficiary_id IS NOT NULL)
  );--> statement-breakpoint
ALTER TABLE "gifts"
  ADD CONSTRAINT "gifts_amount_positive" CHECK (amount > 0);--> statement-breakpoint
UPDATE "tax_year_parameters" SET "gift_annual_exclusion" = 18000 WHERE "year" <= 2024;--> statement-breakpoint
UPDATE "tax_year_parameters" SET "gift_annual_exclusion" = 19000 WHERE "year" IN (2025, 2026);