ALTER TABLE "crm_household_contacts" ADD COLUMN "family_member_id" uuid;--> statement-breakpoint
ALTER TABLE "crm_household_contacts" ADD COLUMN "relationship_label" text;--> statement-breakpoint
ALTER TABLE "crm_household_contacts" ADD CONSTRAINT "crm_household_contacts_family_member_id_family_members_id_fk" FOREIGN KEY ("family_member_id") REFERENCES "public"."family_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "crm_contacts_family_member_uniq" ON "crm_household_contacts" USING btree ("family_member_id") WHERE family_member_id is not null;