CREATE TYPE "public"."tax_return_document_role" AS ENUM('full_return', 'k1', 'w2', 'other');--> statement-breakpoint
CREATE TABLE "tax_return_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tax_return_id" uuid NOT NULL,
	"role" "tax_return_document_role" NOT NULL,
	"filename" text,
	"vault_document_id" uuid,
	"extracted_facts" jsonb,
	"supporting_payload" jsonb,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"prompt_version" text,
	"model" text,
	"tax_year" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_return_state" (
	"tax_return_id" uuid PRIMARY KEY NOT NULL,
	"facts_overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ai_second_read" jsonb,
	"ai_second_read_doc_hash" text,
	"ai_second_read_version" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tax_return_documents" ADD CONSTRAINT "tax_return_documents_tax_return_id_tax_returns_id_fk" FOREIGN KEY ("tax_return_id") REFERENCES "public"."tax_returns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_return_documents" ADD CONSTRAINT "tax_return_documents_vault_document_id_crm_household_documents_id_fk" FOREIGN KEY ("vault_document_id") REFERENCES "public"."crm_household_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_return_state" ADD CONSTRAINT "tax_return_state_tax_return_id_tax_returns_id_fk" FOREIGN KEY ("tax_return_id") REFERENCES "public"."tax_returns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tax_return_documents_return_idx" ON "tax_return_documents" USING btree ("tax_return_id");