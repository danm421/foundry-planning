CREATE TYPE "public"."ltc_benefit_period" AS ENUM('years', 'lifetime');--> statement-breakpoint
CREATE TYPE "public"."ltc_benefit_type" AS ENUM('reimbursement', 'indemnity');--> statement-breakpoint
CREATE TYPE "public"."ltc_benefit_unit" AS ENUM('day', 'month');--> statement-breakpoint
CREATE TYPE "public"."ltc_inflation_rider" AS ENUM('none', 'simple', 'compound');--> statement-breakpoint
CREATE TYPE "public"."ltc_insured" AS ENUM('client', 'spouse');--> statement-breakpoint
CREATE TYPE "public"."ltc_policy_kind" AS ENUM('standalone', 'life_rider');--> statement-breakpoint
CREATE TYPE "public"."ltc_premium_pay" AS ENUM('lifetime', 'to_age', 'years', 'paid_up');--> statement-breakpoint
CREATE TYPE "public"."ltc_rider_benefit_mode" AS ENUM('pct_of_face', 'fixed');--> statement-breakpoint
CREATE TABLE "ltc_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"insured" "ltc_insured" NOT NULL,
	"carrier" text,
	"kind" "ltc_policy_kind" DEFAULT 'standalone' NOT NULL,
	"life_policy_account_id" uuid,
	"issue_year" integer NOT NULL,
	"benefit_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"benefit_unit" "ltc_benefit_unit" DEFAULT 'month' NOT NULL,
	"rider_benefit_mode" "ltc_rider_benefit_mode",
	"rider_monthly_pct" numeric(6, 5),
	"benefit_period_mode" "ltc_benefit_period",
	"benefit_period_years" integer,
	"rider_max_pct" numeric(5, 4),
	"extension_years" integer DEFAULT 0 NOT NULL,
	"residual_death_benefit" numeric(15, 2) DEFAULT '0' NOT NULL,
	"elimination_days" integer DEFAULT 90 NOT NULL,
	"home_care_pct" numeric(5, 4) DEFAULT '1' NOT NULL,
	"inflation_rider" "ltc_inflation_rider" DEFAULT 'none' NOT NULL,
	"inflation_rate" numeric(5, 4) DEFAULT '0.03' NOT NULL,
	"benefit_type" "ltc_benefit_type" DEFAULT 'reimbursement' NOT NULL,
	"shared_care" boolean DEFAULT false NOT NULL,
	"annual_premium" numeric(15, 2) DEFAULT '0' NOT NULL,
	"premium_pay_mode" "ltc_premium_pay" DEFAULT 'lifetime' NOT NULL,
	"premium_pay_to_age" integer,
	"premium_pay_years" integer,
	"partnership" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ltc_policies" ADD CONSTRAINT "ltc_policies_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ltc_policies" ADD CONSTRAINT "ltc_policies_life_policy_account_id_accounts_id_fk" FOREIGN KEY ("life_policy_account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ltc_policies_client_idx" ON "ltc_policies" USING btree ("client_id");