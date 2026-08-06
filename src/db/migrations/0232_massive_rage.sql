ALTER TYPE "public"."crm_document_source_kind" ADD VALUE 'intake_upload';--> statement-breakpoint
ALTER TABLE "intake_forms" ADD COLUMN "crm_household_id" uuid;--> statement-breakpoint
ALTER TABLE "intake_forms" ADD CONSTRAINT "intake_forms_crm_household_id_crm_households_id_fk" FOREIGN KEY ("crm_household_id") REFERENCES "public"."crm_households"("id") ON DELETE set null ON UPDATE no action;