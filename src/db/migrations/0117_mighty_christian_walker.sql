CREATE TYPE "public"."crm_activity_kind" AS ENUM('note', 'call', 'meeting', 'email', 'status_change', 'contact_change', 'account_change', 'document_uploaded', 'planning_link');--> statement-breakpoint
CREATE TYPE "public"."crm_contact_role" AS ENUM('primary', 'spouse', 'dependent', 'other');--> statement-breakpoint
CREATE TYPE "public"."crm_household_status" AS ENUM('prospect', 'active', 'inactive', 'archived');--> statement-breakpoint
CREATE TABLE "crm_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"firm_id" text NOT NULL,
	"actor_user_id" text,
	"kind" "crm_activity_kind" NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"metadata" jsonb,
	"occurred_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_household_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"contact_id" uuid,
	"account_type" text,
	"custodian" text,
	"account_number_last4" text,
	"balance" numeric(14, 2),
	"balance_as_of" date,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_household_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"role" "crm_contact_role" NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"preferred_name" text,
	"date_of_birth" date,
	"email" text,
	"phone" text,
	"mobile" text,
	"address_line1" text,
	"address_line2" text,
	"city" text,
	"state" text,
	"postal_code" text,
	"country" text,
	"ssn_last4" text,
	"marital_status" text,
	"employment_status" text,
	"employer" text,
	"occupation" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_household_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"storage_provider" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text,
	"size_bytes" bigint,
	"uploaded_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_households" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" text NOT NULL,
	"advisor_id" text NOT NULL,
	"name" text NOT NULL,
	"status" "crm_household_status" DEFAULT 'prospect' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "crm_household_id" uuid;--> statement-breakpoint
ALTER TABLE "crm_activity" ADD CONSTRAINT "crm_activity_household_id_crm_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."crm_households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_household_accounts" ADD CONSTRAINT "crm_household_accounts_household_id_crm_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."crm_households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_household_accounts" ADD CONSTRAINT "crm_household_accounts_contact_id_crm_household_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."crm_household_contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_household_contacts" ADD CONSTRAINT "crm_household_contacts_household_id_crm_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."crm_households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_household_documents" ADD CONSTRAINT "crm_household_documents_household_id_crm_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."crm_households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crm_activity_household_occurred_idx" ON "crm_activity" USING btree ("household_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "crm_accounts_household_idx" ON "crm_household_accounts" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "crm_contacts_household_idx" ON "crm_household_contacts" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "crm_contacts_name_idx" ON "crm_household_contacts" USING btree ("last_name","first_name");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_contacts_one_primary_per_household" ON "crm_household_contacts" USING btree ("household_id") WHERE role = 'primary';--> statement-breakpoint
CREATE UNIQUE INDEX "crm_contacts_one_spouse_per_household" ON "crm_household_contacts" USING btree ("household_id") WHERE role = 'spouse';--> statement-breakpoint
CREATE INDEX "crm_documents_household_idx" ON "crm_household_documents" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "crm_households_firm_idx" ON "crm_households" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "crm_households_firm_status_idx" ON "crm_households" USING btree ("firm_id","status");