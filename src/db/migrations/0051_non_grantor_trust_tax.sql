ALTER TABLE "entities" ADD COLUMN "distribution_mode" text;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "distribution_amount" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "distribution_percent" numeric(7, 4);--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "income_beneficiary_family_member_id" uuid;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "income_beneficiary_external_id" uuid;--> statement-breakpoint
ALTER TABLE "plan_settings" ADD COLUMN "out_of_household_dni_rate" numeric(5, 4) DEFAULT '0.37' NOT NULL;--> statement-breakpoint
ALTER TABLE "tax_year_parameters" ADD COLUMN "trust_income_brackets" jsonb;--> statement-breakpoint
ALTER TABLE "tax_year_parameters" ADD COLUMN "trust_cap_gains_brackets" jsonb;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_income_beneficiary_family_member_id_family_members_id_fk" FOREIGN KEY ("income_beneficiary_family_member_id") REFERENCES "public"."family_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_income_beneficiary_external_id_external_beneficiaries_id_fk" FOREIGN KEY ("income_beneficiary_external_id") REFERENCES "public"."external_beneficiaries"("id") ON DELETE no action ON UPDATE no action;