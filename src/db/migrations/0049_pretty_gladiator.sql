CREATE TYPE "public"."cash_value_growth_mode" AS ENUM('basic', 'free_form');--> statement-breakpoint
CREATE TYPE "public"."insured_person" AS ENUM('client', 'spouse', 'joint');--> statement-breakpoint
CREATE TYPE "public"."policy_type" AS ENUM('term', 'whole', 'universal', 'variable');--> statement-breakpoint
ALTER TYPE "public"."source" ADD VALUE 'policy';--> statement-breakpoint
CREATE TABLE "life_insurance_cash_value_schedule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"cash_value" numeric(15, 2) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "life_insurance_cash_value_schedule_policy_id_year_unique" UNIQUE("policy_id","year")
);
--> statement-breakpoint
CREATE TABLE "life_insurance_policies" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"face_value" numeric(15, 2) DEFAULT '0' NOT NULL,
	"cost_basis" numeric(15, 2) DEFAULT '0' NOT NULL,
	"premium_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"premium_years" integer,
	"policy_type" "policy_type" NOT NULL,
	"term_issue_year" integer,
	"term_length_years" integer,
	"ends_at_insured_retirement" boolean DEFAULT false NOT NULL,
	"cash_value_growth_mode" "cash_value_growth_mode" DEFAULT 'basic' NOT NULL,
	"post_payout_merge_account_id" uuid,
	"post_payout_growth_rate" numeric(5, 4) DEFAULT '0.06' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "insured_person" "insured_person";--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "source_policy_account_id" uuid;--> statement-breakpoint
ALTER TABLE "life_insurance_cash_value_schedule" ADD CONSTRAINT "life_insurance_cash_value_schedule_policy_id_life_insurance_policies_account_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."life_insurance_policies"("account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "life_insurance_policies" ADD CONSTRAINT "life_insurance_policies_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "life_insurance_policies" ADD CONSTRAINT "life_insurance_policies_post_payout_merge_account_id_accounts_id_fk" FOREIGN KEY ("post_payout_merge_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_source_policy_account_id_accounts_id_fk" FOREIGN KEY ("source_policy_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;