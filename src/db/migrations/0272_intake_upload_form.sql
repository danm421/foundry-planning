ALTER TABLE "crm_household_documents" ADD COLUMN "intake_form_id" uuid;--> statement-breakpoint
ALTER TABLE "crm_household_documents" ADD CONSTRAINT "crm_household_documents_intake_form_id_intake_forms_id_fk" FOREIGN KEY ("intake_form_id") REFERENCES "public"."intake_forms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crm_documents_intake_form_idx" ON "crm_household_documents" USING btree ("intake_form_id");--> statement-breakpoint
-- Attribute uploads made before this column existed to the form they came
-- through (each upload's audit record names it), so forms still in progress
-- keep listing their own files.
UPDATE "crm_household_documents" AS d
SET "intake_form_id" = f."id"
FROM "audit_log" AS a
JOIN "intake_forms" AS f ON f."id"::text = a."metadata"->>'formId'
WHERE a."action" = 'intake.document.uploaded'
  AND a."resource_type" = 'crm_document'
  AND a."resource_id" = d."id"::text
  AND a."firm_id" = f."firm_id"
  AND d."source_kind" = 'intake_upload'
  AND d."intake_form_id" IS NULL;
