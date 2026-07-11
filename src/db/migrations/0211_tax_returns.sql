CREATE TYPE "public"."tax_return_status" AS ENUM('extracting', 'needs_review', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "tax_returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"tax_year" integer NOT NULL,
	"status" "tax_return_status" DEFAULT 'extracting' NOT NULL,
	"extracted_facts" jsonb,
	"facts" jsonb,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"vault_document_id" uuid,
	"source_filename" text,
	"prompt_version" text,
	"model" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tax_returns_unique_client_year" UNIQUE("client_id","tax_year")
);
--> statement-breakpoint
ALTER TABLE "tax_returns" ADD CONSTRAINT "tax_returns_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_returns" ADD CONSTRAINT "tax_returns_vault_document_id_crm_household_documents_id_fk" FOREIGN KEY ("vault_document_id") REFERENCES "public"."crm_household_documents"("id") ON DELETE set null ON UPDATE no action;