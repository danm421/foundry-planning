ALTER TABLE "accounts" DROP CONSTRAINT "accounts_note_linked_trust_entity_id_entities_id_fk";
--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "sub_type" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "sub_type" SET DEFAULT 'other'::text;--> statement-breakpoint
ALTER TABLE "asset_transactions" ALTER COLUMN "asset_sub_type" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."account_sub_type";--> statement-breakpoint
CREATE TYPE "public"."account_sub_type" AS ENUM('brokerage', 'savings', 'checking', 'traditional_ira', 'roth_ira', '401k', '403b', '529', 'trust', 'other', 'primary_residence', 'rental_property', 'commercial_property', 'sole_proprietorship', 'partnership', 's_corp', 'c_corp', 'llc', 'term', 'whole_life', 'universal_life', 'variable_life');--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "sub_type" SET DEFAULT 'other'::"public"."account_sub_type";--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "sub_type" SET DATA TYPE "public"."account_sub_type" USING "sub_type"::"public"."account_sub_type";--> statement-breakpoint
ALTER TABLE "asset_transactions" ALTER COLUMN "asset_sub_type" SET DATA TYPE "public"."account_sub_type" USING "asset_sub_type"::"public"."account_sub_type";--> statement-breakpoint
ALTER TABLE "accounts" DROP COLUMN "note_interest_rate";--> statement-breakpoint
ALTER TABLE "accounts" DROP COLUMN "note_term_months";--> statement-breakpoint
ALTER TABLE "accounts" DROP COLUMN "note_start_year";--> statement-breakpoint
ALTER TABLE "accounts" DROP COLUMN "note_payment_type";--> statement-breakpoint
ALTER TABLE "accounts" DROP COLUMN "note_linked_trust_entity_id";