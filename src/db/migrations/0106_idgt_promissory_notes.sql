CREATE TYPE "public"."note_payment_type" AS ENUM('amortizing', 'interest_only_balloon');--> statement-breakpoint
ALTER TYPE "public"."account_sub_type" ADD VALUE 'promissory_note' BEFORE 'primary_residence';--> statement-breakpoint
ALTER TYPE "public"."trust_sub_type" ADD VALUE 'idgt';--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "note_interest_rate" numeric(7, 4);--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "note_term_months" integer;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "note_start_year" integer;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "note_payment_type" "note_payment_type";--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "note_linked_trust_entity_id" uuid;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "grantor_status_end_year" integer;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_note_linked_trust_entity_id_entities_id_fk" FOREIGN KEY ("note_linked_trust_entity_id") REFERENCES "public"."entities"("id") ON DELETE set null ON UPDATE no action;