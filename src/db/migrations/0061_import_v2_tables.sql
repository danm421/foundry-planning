CREATE TYPE "public"."extraction_model" AS ENUM('mini', 'full');--> statement-breakpoint
CREATE TYPE "public"."extraction_status" AS ENUM('queued', 'extracting', 'success', 'failed');--> statement-breakpoint
CREATE TYPE "public"."import_document_type" AS ENUM('auto', 'account_statement', 'pay_stub', 'insurance', 'expense_worksheet', 'tax_return', 'excel_import', 'fact_finder', 'will', 'family_fact_finder');--> statement-breakpoint
CREATE TYPE "public"."import_mode" AS ENUM('onboarding', 'updating');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('draft', 'extracting', 'review', 'committed', 'discarded');--> statement-breakpoint
CREATE TABLE "client_import_extractions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" uuid NOT NULL,
	"model" "extraction_model" NOT NULL,
	"prompt_version" text NOT NULL,
	"status" "extraction_status" DEFAULT 'queued' NOT NULL,
	"raw_response_json" jsonb,
	"warnings" jsonb,
	"error_message" text,
	"started_at" timestamp,
	"finished_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_import_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_id" uuid NOT NULL,
	"blob_url" text NOT NULL,
	"blob_pathname" text NOT NULL,
	"original_filename" text NOT NULL,
	"content_hash" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"detected_kind" text NOT NULL,
	"document_type" "import_document_type" DEFAULT 'auto' NOT NULL,
	"ssn_redaction_count" integer DEFAULT 0 NOT NULL,
	"uploaded_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "client_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"org_id" text NOT NULL,
	"scenario_id" uuid,
	"mode" "import_mode" NOT NULL,
	"status" "import_status" DEFAULT 'draft' NOT NULL,
	"created_by_user_id" text NOT NULL,
	"committed_by_user_id" text,
	"committed_at" timestamp,
	"discarded_at" timestamp,
	"notes" text,
	"payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"per_tab_committed_at" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "client_import_extractions" ADD CONSTRAINT "client_import_extractions_file_id_client_import_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."client_import_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_import_files" ADD CONSTRAINT "client_import_files_import_id_client_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."client_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_imports" ADD CONSTRAINT "client_imports_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_imports" ADD CONSTRAINT "client_imports_scenario_id_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."scenarios"("id") ON DELETE set null ON UPDATE no action;