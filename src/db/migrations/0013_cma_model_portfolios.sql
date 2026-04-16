-- Add CMA (Capital Market Assumptions) and Model Portfolios support.
-- New enums: growth_source, income_tax_type
-- New tables: asset_classes, model_portfolios, model_portfolio_allocations, client_cma_overrides
-- Altered tables: plan_settings (growth source per category, use_custom_cma),
--                 accounts (growth_source, model_portfolio_id, turnover, tax-split overrides),
--                 incomes (tax_type)
CREATE TYPE "public"."growth_source" AS ENUM('default', 'model_portfolio', 'custom');
--> statement-breakpoint
CREATE TYPE "public"."income_tax_type" AS ENUM('earned_income', 'ordinary_income', 'dividends', 'capital_gains', 'qbi', 'tax_exempt', 'stcg');
--> statement-breakpoint
CREATE TABLE "asset_classes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "firm_id" text NOT NULL,
  "name" text NOT NULL,
  "geometric_return" numeric(7, 4) DEFAULT '0.07' NOT NULL,
  "arithmetic_mean" numeric(7, 4) DEFAULT '0.085' NOT NULL,
  "volatility" numeric(7, 4) DEFAULT '0.15' NOT NULL,
  "pct_ordinary_income" numeric(5, 4) DEFAULT '0' NOT NULL,
  "pct_lt_capital_gains" numeric(5, 4) DEFAULT '0.85' NOT NULL,
  "pct_qualified_dividends" numeric(5, 4) DEFAULT '0.15' NOT NULL,
  "pct_tax_exempt" numeric(5, 4) DEFAULT '0' NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_portfolios" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "firm_id" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
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
ALTER TABLE "model_portfolio_allocations" ADD CONSTRAINT "model_portfolio_allocations_model_portfolio_id_model_portfolios_id_fk" FOREIGN KEY ("model_portfolio_id") REFERENCES "public"."model_portfolios"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "model_portfolio_allocations" ADD CONSTRAINT "model_portfolio_allocations_asset_class_id_asset_classes_id_fk" FOREIGN KEY ("asset_class_id") REFERENCES "public"."asset_classes"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "client_cma_overrides" ADD CONSTRAINT "client_cma_overrides_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "client_cma_overrides" ADD CONSTRAINT "client_cma_overrides_source_asset_class_id_asset_classes_id_fk" FOREIGN KEY ("source_asset_class_id") REFERENCES "public"."asset_classes"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "plan_settings" ADD COLUMN "growth_source_taxable" "growth_source" DEFAULT 'custom' NOT NULL;
--> statement-breakpoint
ALTER TABLE "plan_settings" ADD COLUMN "model_portfolio_id_taxable" uuid;
--> statement-breakpoint
ALTER TABLE "plan_settings" ADD COLUMN "growth_source_cash" "growth_source" DEFAULT 'custom' NOT NULL;
--> statement-breakpoint
ALTER TABLE "plan_settings" ADD COLUMN "model_portfolio_id_cash" uuid;
--> statement-breakpoint
ALTER TABLE "plan_settings" ADD COLUMN "growth_source_retirement" "growth_source" DEFAULT 'custom' NOT NULL;
--> statement-breakpoint
ALTER TABLE "plan_settings" ADD COLUMN "model_portfolio_id_retirement" uuid;
--> statement-breakpoint
ALTER TABLE "plan_settings" ADD COLUMN "use_custom_cma" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "growth_source" "growth_source" DEFAULT 'default' NOT NULL;
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "model_portfolio_id" uuid;
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "turnover_pct" numeric(5, 4) DEFAULT '0' NOT NULL;
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "override_pct_oi" numeric(5, 4);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "override_pct_lt_cg" numeric(5, 4);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "override_pct_qdiv" numeric(5, 4);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "override_pct_tax_exempt" numeric(5, 4);
--> statement-breakpoint
ALTER TABLE "incomes" ADD COLUMN "tax_type" "income_tax_type";
--> statement-breakpoint
ALTER TABLE "plan_settings" ADD CONSTRAINT "plan_settings_model_portfolio_id_taxable_model_portfolios_id_fk" FOREIGN KEY ("model_portfolio_id_taxable") REFERENCES "public"."model_portfolios"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "plan_settings" ADD CONSTRAINT "plan_settings_model_portfolio_id_cash_model_portfolios_id_fk" FOREIGN KEY ("model_portfolio_id_cash") REFERENCES "public"."model_portfolios"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "plan_settings" ADD CONSTRAINT "plan_settings_model_portfolio_id_retirement_model_portfolios_id_fk" FOREIGN KEY ("model_portfolio_id_retirement") REFERENCES "public"."model_portfolios"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_model_portfolio_id_model_portfolios_id_fk" FOREIGN KEY ("model_portfolio_id") REFERENCES "public"."model_portfolios"("id") ON DELETE set null ON UPDATE no action;
