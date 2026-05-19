ALTER TABLE "account_owners" DROP CONSTRAINT "account_owners_uniq";--> statement-breakpoint
ALTER TABLE "account_owners" DROP CONSTRAINT "account_owners_one_owner";--> statement-breakpoint
ALTER TABLE "account_owners" ADD COLUMN "external_beneficiary_id" uuid;--> statement-breakpoint
ALTER TABLE "account_owners" ADD CONSTRAINT "account_owners_external_beneficiary_id_external_beneficiaries_id_fk" FOREIGN KEY ("external_beneficiary_id") REFERENCES "public"."external_beneficiaries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_owners" ADD CONSTRAINT "account_owners_uniq" UNIQUE NULLS NOT DISTINCT("account_id","family_member_id","entity_id","external_beneficiary_id");--> statement-breakpoint
ALTER TABLE "account_owners" ADD CONSTRAINT "account_owners_one_owner" CHECK (("account_owners"."family_member_id" IS NOT NULL)::int
        + ("account_owners"."entity_id" IS NOT NULL)::int
        + ("account_owners"."external_beneficiary_id" IS NOT NULL)::int = 1);