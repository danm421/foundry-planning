CREATE TYPE "public"."crm_document_source_kind" AS ENUM('upload', 'generated_plan', 'import_ref');--> statement-breakpoint
CREATE TABLE "crm_document_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"firm_id" text NOT NULL,
	"parent_folder_id" uuid,
	"name" text NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crm_household_documents" ALTER COLUMN "storage_key" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_household_documents" ADD COLUMN "folder_id" uuid;--> statement-breakpoint
ALTER TABLE "crm_household_documents" ADD COLUMN "source_kind" "crm_document_source_kind" DEFAULT 'upload' NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_household_documents" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "crm_household_documents" ADD COLUMN "version_group_id" uuid;--> statement-breakpoint
ALTER TABLE "crm_household_documents" ADD COLUMN "version_no" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_household_documents" ADD COLUMN "is_current_version" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_household_documents" ADD COLUMN "import_file_id" uuid;--> statement-breakpoint
ALTER TABLE "crm_household_documents" ADD COLUMN "report_type" text;--> statement-breakpoint
ALTER TABLE "crm_household_documents" ADD COLUMN "scenario_id" uuid;--> statement-breakpoint
ALTER TABLE "crm_document_folders" ADD CONSTRAINT "crm_document_folders_household_id_crm_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."crm_households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_document_folders" ADD CONSTRAINT "crm_document_folders_parent_folder_id_crm_document_folders_id_fk" FOREIGN KEY ("parent_folder_id") REFERENCES "public"."crm_document_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crm_document_folders_household_idx" ON "crm_document_folders" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "crm_document_folders_parent_idx" ON "crm_document_folders" USING btree ("household_id","parent_folder_id");--> statement-breakpoint
ALTER TABLE "crm_household_documents" ADD CONSTRAINT "crm_household_documents_folder_id_crm_document_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."crm_document_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_household_documents" ADD CONSTRAINT "crm_household_documents_import_file_id_client_import_files_id_fk" FOREIGN KEY ("import_file_id") REFERENCES "public"."client_import_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_household_documents" ADD CONSTRAINT "crm_household_documents_scenario_id_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."scenarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crm_documents_version_group_idx" ON "crm_household_documents" USING btree ("version_group_id");--> statement-breakpoint
CREATE INDEX "crm_documents_folder_idx" ON "crm_household_documents" USING btree ("folder_id");