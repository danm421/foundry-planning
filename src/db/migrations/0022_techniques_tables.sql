CREATE TYPE "public"."asset_transaction_type" AS ENUM('buy', 'sell');--> statement-breakpoint
CREATE TYPE "public"."deduction_type" AS ENUM('charitable', 'above_line', 'below_line', 'property_tax');--> statement-breakpoint
CREATE TYPE "public"."entity_type" AS ENUM('trust', 'llc', 's_corp', 'c_corp', 'partnership', 'foundation', 'other');--> statement-breakpoint
CREATE TYPE "public"."family_relationship" AS ENUM('child', 'grandchild', 'parent', 'sibling', 'other');--> statement-breakpoint
CREATE TYPE "public"."growth_source" AS ENUM('default', 'model_portfolio', 'custom', 'asset_mix');--> statement-breakpoint
CREATE TYPE "public"."income_tax_type" AS ENUM('earned_income', 'ordinary_income', 'dividends', 'capital_gains', 'qbi', 'tax_exempt', 'stcg');--> statement-breakpoint
CREATE TYPE "public"."tax_engine_mode" AS ENUM('flat', 'bracket');--> statement-breakpoint
CREATE TYPE "public"."transfer_mode" AS ENUM('one_time', 'recurring', 'scheduled');--> statement-breakpoint
CREATE TYPE "public"."year_ref" AS ENUM('plan_start', 'plan_end', 'client_retirement', 'spouse_retirement', 'client_end', 'spouse_end', 'client_ss_62', 'client_ss_fra', 'client_ss_70', 'spouse_ss_62', 'spouse_ss_fra', 'spouse_ss_70');--> statement-breakpoint
ALTER TYPE "public"."account_category" ADD VALUE 'real_estate';--> statement-breakpoint
ALTER TYPE "public"."account_category" ADD VALUE 'business';--> statement-breakpoint
ALTER TYPE "public"."account_category" ADD VALUE 'life_insurance';--> statement-breakpoint
ALTER TYPE "public"."account_sub_type" ADD VALUE 'primary_residence';--> statement-breakpoint
ALTER TYPE "public"."account_sub_type" ADD VALUE 'rental_property';--> statement-breakpoint
ALTER TYPE "public"."account_sub_type" ADD VALUE 'commercial_property';--> statement-breakpoint
ALTER TYPE "public"."account_sub_type" ADD VALUE 'sole_proprietorship';--> statement-breakpoint
ALTER TYPE "public"."account_sub_type" ADD VALUE 'partnership';--> statement-breakpoint
ALTER TYPE "public"."account_sub_type" ADD VALUE 's_corp';--> statement-breakpoint
ALTER TYPE "public"."account_sub_type" ADD VALUE 'c_corp';--> statement-breakpoint
ALTER TYPE "public"."account_sub_type" ADD VALUE 'llc';--> statement-breakpoint
ALTER TYPE "public"."account_sub_type" ADD VALUE 'term';--> statement-breakpoint
ALTER TYPE "public"."account_sub_type" ADD VALUE 'whole_life';--> statement-breakpoint
ALTER TYPE "public"."account_sub_type" ADD VALUE 'universal_life';--> statement-breakpoint
ALTER TYPE "public"."account_sub_type" ADD VALUE 'variable_life';--> statement-breakpoint
CREATE TABLE "account_asset_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"asset_class_id" uuid NOT NULL,
	"weight" numeric(5, 4) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_classes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" varchar(50),
	"geometric_return" numeric(7, 4) DEFAULT '0.07' NOT NULL,
	"arithmetic_mean" numeric(7, 4) DEFAULT '0.085' NOT NULL,
	"volatility" numeric(7, 4) DEFAULT '0.15' NOT NULL,
	"pct_ordinary_income" numeric(5, 4) DEFAULT '0' NOT NULL,
	"pct_lt_capital_gains" numeric(5, 4) DEFAULT '0.85' NOT NULL,
	"pct_qualified_dividends" numeric(5, 4) DEFAULT '0.15' NOT NULL,
	"pct_tax_exempt" numeric(5, 4) DEFAULT '0' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "asset_classes_firm_id_name_unique" UNIQUE("firm_id","name")
);
--> statement-breakpoint
CREATE TABLE "asset_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"scenario_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" "asset_transaction_type" NOT NULL,
	"year" integer NOT NULL,
	"account_id" uuid,
	"override_sale_value" numeric(15, 2),
	"override_basis" numeric(15, 2),
	"transaction_cost_pct" numeric(5, 4),
	"transaction_cost_flat" numeric(15, 2),
	"proceeds_account_id" uuid,
	"asset_name" text,
	"asset_category" "account_category",
	"asset_sub_type" "account_sub_type",
	"purchase_price" numeric(15, 2),
	"growth_rate" numeric(5, 4),
	"asset_growth_source" "growth_source",
	"asset_model_portfolio_id" uuid,
	"basis" numeric(15, 2),
	"funding_account_id" uuid,
	"mortgage_amount" numeric(15, 2),
	"mortgage_rate" numeric(5, 4),
	"mortgage_term_months" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_cma_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"source_asset_class_id" uuid,
	"name" text NOT NULL,
	"geometric_return" numeric(7, 4) NOT NULL,
	"arithmetic_mean" numeric(7, 4) NOT NULL,
	"volatility" numeric(7, 4) NOT NULL,
	"pct_ordinary_income" numeric(5, 4) NOT NULL,
	"pct_lt_capital_gains" numeric(5, 4) NOT NULL,
	"pct_qualified_dividends" numeric(5, 4) NOT NULL,
	"pct_tax_exempt" numeric(5, 4) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_deductions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"scenario_id" uuid NOT NULL,
	"type" "deduction_type" NOT NULL,
	"name" text,
	"owner" "owner" DEFAULT 'joint' NOT NULL,
	"annual_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"growth_rate" numeric(5, 4) DEFAULT '0' NOT NULL,
	"start_year" integer NOT NULL,
	"end_year" integer NOT NULL,
	"start_year_ref" "year_ref",
	"end_year_ref" "year_ref",
	"source" "source" DEFAULT 'manual' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"entity_type" "entity_type" DEFAULT 'trust' NOT NULL,
	"include_in_portfolio" boolean DEFAULT false NOT NULL,
	"is_grantor" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "family_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text,
	"relationship" "family_relationship" DEFAULT 'child' NOT NULL,
	"date_of_birth" date,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_portfolio_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model_portfolio_id" uuid NOT NULL,
	"asset_class_id" uuid NOT NULL,
	"weight" numeric(5, 4) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_portfolios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "model_portfolios_firm_id_name_unique" UNIQUE("firm_id","name")
);
--> statement-breakpoint
CREATE TABLE "tax_year_parameters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"year" integer NOT NULL,
	"income_brackets" jsonb NOT NULL,
	"cap_gains_brackets" jsonb NOT NULL,
	"std_deduction_mfj" numeric(10, 2) NOT NULL,
	"std_deduction_single" numeric(10, 2) NOT NULL,
	"std_deduction_hoh" numeric(10, 2) NOT NULL,
	"std_deduction_mfs" numeric(10, 2) NOT NULL,
	"amt_exemption_mfj" numeric(12, 2) NOT NULL,
	"amt_exemption_single_hoh" numeric(12, 2) NOT NULL,
	"amt_exemption_mfs" numeric(12, 2) NOT NULL,
	"amt_breakpoint_2628_mfj_shoh" numeric(12, 2) NOT NULL,
	"amt_breakpoint_2628_mfs" numeric(12, 2) NOT NULL,
	"amt_phaseout_start_mfj" numeric(12, 2) NOT NULL,
	"amt_phaseout_start_single_hoh" numeric(12, 2) NOT NULL,
	"amt_phaseout_start_mfs" numeric(12, 2) NOT NULL,
	"ss_tax_rate" numeric(5, 4) NOT NULL,
	"ss_wage_base" numeric(12, 2) NOT NULL,
	"medicare_tax_rate" numeric(5, 4) NOT NULL,
	"addl_medicare_rate" numeric(5, 4) NOT NULL,
	"addl_medicare_threshold_mfj" numeric(12, 2) NOT NULL,
	"addl_medicare_threshold_single" numeric(12, 2) NOT NULL,
	"addl_medicare_threshold_mfs" numeric(12, 2) NOT NULL,
	"niit_rate" numeric(5, 4) NOT NULL,
	"niit_threshold_mfj" numeric(12, 2) NOT NULL,
	"niit_threshold_single" numeric(12, 2) NOT NULL,
	"niit_threshold_mfs" numeric(12, 2) NOT NULL,
	"qbi_threshold_mfj" numeric(12, 2) NOT NULL,
	"qbi_threshold_single_hoh_mfs" numeric(12, 2) NOT NULL,
	"qbi_phase_in_range_mfj" numeric(12, 2) NOT NULL,
	"qbi_phase_in_range_other" numeric(12, 2) NOT NULL,
	"ira_401k_elective" numeric(10, 2) NOT NULL,
	"ira_401k_catchup_50" numeric(10, 2) NOT NULL,
	"ira_401k_catchup_60_63" numeric(10, 2),
	"ira_trad_limit" numeric(10, 2) NOT NULL,
	"ira_catchup_50" numeric(10, 2) NOT NULL,
	"simple_limit_regular" numeric(10, 2) NOT NULL,
	"simple_catchup_50" numeric(10, 2) NOT NULL,
	"hsa_limit_self" numeric(10, 2) NOT NULL,
	"hsa_limit_family" numeric(10, 2) NOT NULL,
	"hsa_catchup_55" numeric(10, 2) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tax_year_parameters_year_unique" UNIQUE("year")
);
--> statement-breakpoint
CREATE TABLE "transfer_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transfer_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"scenario_id" uuid NOT NULL,
	"name" text NOT NULL,
	"source_account_id" uuid NOT NULL,
	"target_account_id" uuid NOT NULL,
	"amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"mode" "transfer_mode" DEFAULT 'one_time' NOT NULL,
	"start_year" integer NOT NULL,
	"start_year_ref" "year_ref",
	"end_year" integer,
	"end_year_ref" "year_ref",
	"growth_rate" numeric(5, 4) DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "growth_rate" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "growth_rate" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "rmd_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "is_default_checking" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "owner_entity_id" uuid;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "growth_source" "growth_source" DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "model_portfolio_id" uuid;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "turnover_pct" numeric(5, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "override_pct_oi" numeric(5, 4);--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "override_pct_lt_cg" numeric(5, 4);--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "override_pct_qdiv" numeric(5, 4);--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "override_pct_tax_exempt" numeric(5, 4);--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "annual_property_tax" numeric(15, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "property_tax_growth_rate" numeric(5, 4) DEFAULT '0.03' NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "first_name" text NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "last_name" text NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "spouse_last_name" text;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "start_year_ref" "year_ref";--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "end_year_ref" "year_ref";--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "inflation_start_year" integer;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "owner_entity_id" uuid;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "cash_account_id" uuid;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "deduction_type" "deduction_type";--> statement-breakpoint
ALTER TABLE "incomes" ADD COLUMN "start_year_ref" "year_ref";--> statement-breakpoint
ALTER TABLE "incomes" ADD COLUMN "end_year_ref" "year_ref";--> statement-breakpoint
ALTER TABLE "incomes" ADD COLUMN "inflation_start_year" integer;--> statement-breakpoint
ALTER TABLE "incomes" ADD COLUMN "owner_entity_id" uuid;--> statement-breakpoint
ALTER TABLE "incomes" ADD COLUMN "cash_account_id" uuid;--> statement-breakpoint
ALTER TABLE "incomes" ADD COLUMN "tax_type" "income_tax_type";--> statement-breakpoint
ALTER TABLE "liabilities" ADD COLUMN "start_year_ref" "year_ref";--> statement-breakpoint
ALTER TABLE "liabilities" ADD COLUMN "end_year_ref" "year_ref";--> statement-breakpoint
ALTER TABLE "liabilities" ADD COLUMN "linked_property_id" uuid;--> statement-breakpoint
ALTER TABLE "liabilities" ADD COLUMN "owner_entity_id" uuid;--> statement-breakpoint
ALTER TABLE "liabilities" ADD COLUMN "is_interest_deductible" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "plan_settings" ADD COLUMN "tax_engine_mode" "tax_engine_mode" DEFAULT 'bracket' NOT NULL;--> statement-breakpoint
ALTER TABLE "plan_settings" ADD COLUMN "tax_inflation_rate" numeric(5, 4);--> statement-breakpoint
ALTER TABLE "plan_settings" ADD COLUMN "ss_wage_growth_rate" numeric(5, 4);--> statement-breakpoint
ALTER TABLE "plan_settings" ADD COLUMN "default_growth_taxable" numeric(5, 4) DEFAULT '0.07' NOT NULL;--> statement-breakpoint
ALTER TABLE "plan_settings" ADD COLUMN "default_growth_cash" numeric(5, 4) DEFAULT '0.02' NOT NULL;--> statement-breakpoint
ALTER TABLE "plan_settings" ADD COLUMN "default_growth_retirement" numeric(5, 4) DEFAULT '0.07' NOT NULL;--> statement-breakpoint
ALTER TABLE "plan_settings" ADD COLUMN "default_growth_real_estate" numeric(5, 4) DEFAULT '0.04' NOT NULL;--> statement-breakpoint
ALTER TABLE "plan_settings" ADD COLUMN "default_growth_business" numeric(5, 4) DEFAULT '0.05' NOT NULL;--> statement-breakpoint
ALTER TABLE "plan_settings" ADD COLUMN "default_growth_life_insurance" numeric(5, 4) DEFAULT '0.03' NOT NULL;--> statement-breakpoint
ALTER TABLE "plan_settings" ADD COLUMN "growth_source_taxable" "growth_source" DEFAULT 'custom' NOT NULL;--> statement-breakpoint
ALTER TABLE "plan_settings" ADD COLUMN "model_portfolio_id_taxable" uuid;--> statement-breakpoint
ALTER TABLE "plan_settings" ADD COLUMN "growth_source_cash" "growth_source" DEFAULT 'custom' NOT NULL;--> statement-breakpoint
ALTER TABLE "plan_settings" ADD COLUMN "model_portfolio_id_cash" uuid;--> statement-breakpoint
ALTER TABLE "plan_settings" ADD COLUMN "growth_source_retirement" "growth_source" DEFAULT 'custom' NOT NULL;--> statement-breakpoint
ALTER TABLE "plan_settings" ADD COLUMN "model_portfolio_id_retirement" uuid;--> statement-breakpoint
ALTER TABLE "plan_settings" ADD COLUMN "use_custom_cma" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "savings_rules" ADD COLUMN "start_year_ref" "year_ref";--> statement-breakpoint
ALTER TABLE "savings_rules" ADD COLUMN "end_year_ref" "year_ref";--> statement-breakpoint
ALTER TABLE "savings_rules" ADD COLUMN "employer_match_amount" numeric(15, 2);--> statement-breakpoint
ALTER TABLE "withdrawal_strategies" ADD COLUMN "start_year_ref" "year_ref";--> statement-breakpoint
ALTER TABLE "withdrawal_strategies" ADD COLUMN "end_year_ref" "year_ref";--> statement-breakpoint
ALTER TABLE "account_asset_allocations" ADD CONSTRAINT "account_asset_allocations_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_asset_allocations" ADD CONSTRAINT "account_asset_allocations_asset_class_id_asset_classes_id_fk" FOREIGN KEY ("asset_class_id") REFERENCES "public"."asset_classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_transactions" ADD CONSTRAINT "asset_transactions_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_transactions" ADD CONSTRAINT "asset_transactions_scenario_id_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."scenarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_transactions" ADD CONSTRAINT "asset_transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_transactions" ADD CONSTRAINT "asset_transactions_proceeds_account_id_accounts_id_fk" FOREIGN KEY ("proceeds_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_transactions" ADD CONSTRAINT "asset_transactions_asset_model_portfolio_id_model_portfolios_id_fk" FOREIGN KEY ("asset_model_portfolio_id") REFERENCES "public"."model_portfolios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_transactions" ADD CONSTRAINT "asset_transactions_funding_account_id_accounts_id_fk" FOREIGN KEY ("funding_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_cma_overrides" ADD CONSTRAINT "client_cma_overrides_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_cma_overrides" ADD CONSTRAINT "client_cma_overrides_source_asset_class_id_asset_classes_id_fk" FOREIGN KEY ("source_asset_class_id") REFERENCES "public"."asset_classes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_deductions" ADD CONSTRAINT "client_deductions_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_deductions" ADD CONSTRAINT "client_deductions_scenario_id_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."scenarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_members" ADD CONSTRAINT "family_members_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_portfolio_allocations" ADD CONSTRAINT "model_portfolio_allocations_model_portfolio_id_model_portfolios_id_fk" FOREIGN KEY ("model_portfolio_id") REFERENCES "public"."model_portfolios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_portfolio_allocations" ADD CONSTRAINT "model_portfolio_allocations_asset_class_id_asset_classes_id_fk" FOREIGN KEY ("asset_class_id") REFERENCES "public"."asset_classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_schedules" ADD CONSTRAINT "transfer_schedules_transfer_id_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."transfers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_scenario_id_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."scenarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_source_account_id_accounts_id_fk" FOREIGN KEY ("source_account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_target_account_id_accounts_id_fk" FOREIGN KEY ("target_account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_asset_alloc_uniq" ON "account_asset_allocations" USING btree ("account_id","asset_class_id");--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_owner_entity_id_entities_id_fk" FOREIGN KEY ("owner_entity_id") REFERENCES "public"."entities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_model_portfolio_id_model_portfolios_id_fk" FOREIGN KEY ("model_portfolio_id") REFERENCES "public"."model_portfolios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_owner_entity_id_entities_id_fk" FOREIGN KEY ("owner_entity_id") REFERENCES "public"."entities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_cash_account_id_accounts_id_fk" FOREIGN KEY ("cash_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incomes" ADD CONSTRAINT "incomes_owner_entity_id_entities_id_fk" FOREIGN KEY ("owner_entity_id") REFERENCES "public"."entities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incomes" ADD CONSTRAINT "incomes_cash_account_id_accounts_id_fk" FOREIGN KEY ("cash_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "liabilities" ADD CONSTRAINT "liabilities_linked_property_id_accounts_id_fk" FOREIGN KEY ("linked_property_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "liabilities" ADD CONSTRAINT "liabilities_owner_entity_id_entities_id_fk" FOREIGN KEY ("owner_entity_id") REFERENCES "public"."entities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_settings" ADD CONSTRAINT "plan_settings_model_portfolio_id_taxable_model_portfolios_id_fk" FOREIGN KEY ("model_portfolio_id_taxable") REFERENCES "public"."model_portfolios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_settings" ADD CONSTRAINT "plan_settings_model_portfolio_id_cash_model_portfolios_id_fk" FOREIGN KEY ("model_portfolio_id_cash") REFERENCES "public"."model_portfolios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_settings" ADD CONSTRAINT "plan_settings_model_portfolio_id_retirement_model_portfolios_id_fk" FOREIGN KEY ("model_portfolio_id_retirement") REFERENCES "public"."model_portfolios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" DROP COLUMN "name";