CREATE TYPE "public"."crm_household_relationship_type" AS ENUM('child', 'sibling', 'spouse', 'ex_spouse', 'business_partner', 'referral_source', 'other');--> statement-breakpoint
ALTER TYPE "public"."crm_activity_kind" ADD VALUE 'relationship_change';--> statement-breakpoint
CREATE TABLE "crm_household_relationships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" text NOT NULL,
	"from_household_id" uuid NOT NULL,
	"to_household_id" uuid NOT NULL,
	"relationship_type" "crm_household_relationship_type" NOT NULL,
	"source_family_member_id" uuid,
	"note" text,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "crm_household_rel_not_self" CHECK ("crm_household_relationships"."from_household_id" <> "crm_household_relationships"."to_household_id")
);
--> statement-breakpoint
ALTER TABLE "crm_household_relationships" ADD CONSTRAINT "crm_household_relationships_from_household_id_crm_households_id_fk" FOREIGN KEY ("from_household_id") REFERENCES "public"."crm_households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_household_relationships" ADD CONSTRAINT "crm_household_relationships_to_household_id_crm_households_id_fk" FOREIGN KEY ("to_household_id") REFERENCES "public"."crm_households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_household_relationships" ADD CONSTRAINT "crm_household_relationships_source_family_member_id_family_members_id_fk" FOREIGN KEY ("source_family_member_id") REFERENCES "public"."family_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crm_household_rel_firm_idx" ON "crm_household_relationships" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "crm_household_rel_from_idx" ON "crm_household_relationships" USING btree ("from_household_id");--> statement-breakpoint
CREATE INDEX "crm_household_rel_to_idx" ON "crm_household_relationships" USING btree ("to_household_id");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_household_rel_pair_uniq" ON "crm_household_relationships" USING btree (LEAST("from_household_id", "to_household_id"),GREATEST("from_household_id", "to_household_id"));--> statement-breakpoint
CREATE UNIQUE INDEX "crm_household_rel_source_fm_uniq" ON "crm_household_relationships" USING btree ("source_family_member_id") WHERE "crm_household_relationships"."source_family_member_id" IS NOT NULL;