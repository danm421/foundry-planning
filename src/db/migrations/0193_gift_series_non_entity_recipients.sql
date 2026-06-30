ALTER TABLE "gift_series" ALTER COLUMN "recipient_entity_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "gift_series" ADD COLUMN "recipient_family_member_id" uuid;--> statement-breakpoint
ALTER TABLE "gift_series" ADD COLUMN "recipient_external_beneficiary_id" uuid;--> statement-breakpoint
ALTER TABLE "gift_series" ADD CONSTRAINT "gift_series_recipient_family_member_id_family_members_id_fk" FOREIGN KEY ("recipient_family_member_id") REFERENCES "public"."family_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_series" ADD CONSTRAINT "gift_series_recipient_external_beneficiary_id_external_beneficiaries_id_fk" FOREIGN KEY ("recipient_external_beneficiary_id") REFERENCES "public"."external_beneficiaries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_series" ADD CONSTRAINT "gift_series_one_recipient" CHECK ((
        ("gift_series"."recipient_entity_id" IS NOT NULL)::int +
        ("gift_series"."recipient_family_member_id" IS NOT NULL)::int +
        ("gift_series"."recipient_external_beneficiary_id" IS NOT NULL)::int
      ) = 1);