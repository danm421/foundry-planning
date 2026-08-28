CREATE TYPE "public"."annuity_income_mode" AS ENUM('none', 'rider', 'annuitized');--> statement-breakpoint
CREATE TYPE "public"."annuity_payout_structure" AS ENUM('single_life', 'joint_survivor', 'life_with_period_certain', 'period_certain', 'cash_refund');--> statement-breakpoint
CREATE TYPE "public"."annuity_product_type" AS ENUM('spia', 'dia', 'myga', 'fixed', 'fixed_indexed', 'variable', 'qlac');--> statement-breakpoint
CREATE TYPE "public"."annuity_tax_treatment" AS ENUM('qualified', 'non_qualified', 'tax_free');--> statement-breakpoint
CREATE TABLE "annuity_contracts" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"carrier" text,
	"contract_number_last4" text,
	"product_type" "annuity_product_type" DEFAULT 'fixed' NOT NULL,
	"tax_treatment" "annuity_tax_treatment" DEFAULT 'non_qualified' NOT NULL,
	"cost_basis" numeric(15, 2),
	"surrender_charge_pct" numeric(5, 4),
	"surrender_end_year" integer,
	"annual_fee_pct" numeric(5, 4) DEFAULT '0' NOT NULL,
	"income_mode" "annuity_income_mode" DEFAULT 'none' NOT NULL,
	"income_start_year" integer,
	"income_start_year_ref" "year_ref",
	"payout_structure" "annuity_payout_structure",
	"survivor_pct" numeric(5, 4),
	"period_certain_years" integer,
	"benefit_base" numeric(15, 2),
	"rollup_rate" numeric(5, 4),
	"rollup_end_year" integer,
	"rollup_ratchets" boolean DEFAULT true NOT NULL,
	"rider_fee_pct" numeric(5, 4),
	"payout_pct" numeric(5, 4),
	"annuitized_payment" numeric(15, 2),
	"expected_return_years" numeric(6, 2),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "annuity_rider_needs_benefit_base" CHECK (("annuity_contracts"."income_mode" != 'rider') OR ("annuity_contracts"."benefit_base" IS NOT NULL)),
	CONSTRAINT "annuity_annuitized_needs_payment" CHECK (("annuity_contracts"."income_mode" != 'annuitized') OR ("annuity_contracts"."annuitized_payment" IS NOT NULL)),
	CONSTRAINT "annuity_income_needs_start" CHECK (("annuity_contracts"."income_mode" = 'none') OR ("annuity_contracts"."income_start_year" IS NOT NULL OR "annuity_contracts"."income_start_year_ref" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "annuity_contracts" ADD CONSTRAINT "annuity_contracts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Backfill: every existing annuity account gets a contract row. Defaults are
-- deliberately inert — non-qualified, no income, NULL basis — so an untouched
-- legacy account behaves exactly as it did before this migration.
INSERT INTO "annuity_contracts" ("account_id")
SELECT "id" FROM "accounts" WHERE "category" = 'annuity'
ON CONFLICT ("account_id") DO NOTHING;
