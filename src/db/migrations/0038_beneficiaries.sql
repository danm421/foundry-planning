CREATE TYPE "public"."beneficiary_target_kind" AS ENUM('account', 'trust');--> statement-breakpoint
CREATE TYPE "public"."beneficiary_tier" AS ENUM('primary', 'contingent');--> statement-breakpoint
CREATE TYPE "public"."external_beneficiary_kind" AS ENUM('charity', 'individual');--> statement-breakpoint
CREATE TABLE "beneficiary_designations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"target_kind" "beneficiary_target_kind" NOT NULL,
	"account_id" uuid,
	"entity_id" uuid,
	"tier" "beneficiary_tier" NOT NULL,
	"family_member_id" uuid,
	"external_beneficiary_id" uuid,
	"percentage" numeric(5, 2) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_beneficiaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "external_beneficiary_kind" DEFAULT 'charity' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "owner_family_member_id" uuid;--> statement-breakpoint
ALTER TABLE "beneficiary_designations" ADD CONSTRAINT "beneficiary_designations_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beneficiary_designations" ADD CONSTRAINT "beneficiary_designations_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beneficiary_designations" ADD CONSTRAINT "beneficiary_designations_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beneficiary_designations" ADD CONSTRAINT "beneficiary_designations_family_member_id_family_members_id_fk" FOREIGN KEY ("family_member_id") REFERENCES "public"."family_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beneficiary_designations" ADD CONSTRAINT "beneficiary_designations_external_beneficiary_id_external_beneficiaries_id_fk" FOREIGN KEY ("external_beneficiary_id") REFERENCES "public"."external_beneficiaries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_beneficiaries" ADD CONSTRAINT "external_beneficiaries_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "beneficiary_designations_account_idx" ON "beneficiary_designations" USING btree ("client_id","target_kind","account_id");--> statement-breakpoint
CREATE INDEX "beneficiary_designations_entity_idx" ON "beneficiary_designations" USING btree ("client_id","target_kind","entity_id");--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_owner_family_member_id_family_members_id_fk" FOREIGN KEY ("owner_family_member_id") REFERENCES "public"."family_members"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "beneficiary_designations"
  ADD CONSTRAINT "beneficiary_designations_target_exactly_one" CHECK (
    (target_kind = 'account' AND account_id IS NOT NULL AND entity_id IS NULL) OR
    (target_kind = 'trust'   AND entity_id  IS NOT NULL AND account_id IS NULL)
  );
--> statement-breakpoint
ALTER TABLE "beneficiary_designations"
  ADD CONSTRAINT "beneficiary_designations_beneficiary_exactly_one" CHECK (
    (family_member_id IS NOT NULL AND external_beneficiary_id IS NULL) OR
    (family_member_id IS NULL     AND external_beneficiary_id IS NOT NULL)
  );
--> statement-breakpoint
ALTER TABLE "beneficiary_designations"
  ADD CONSTRAINT "beneficiary_designations_percentage_range" CHECK (
    percentage > 0 AND percentage <= 100
  );