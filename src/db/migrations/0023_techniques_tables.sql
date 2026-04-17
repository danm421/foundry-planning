CREATE TYPE "public"."asset_transaction_type" AS ENUM('buy', 'sell');--> statement-breakpoint
CREATE TYPE "public"."transfer_mode" AS ENUM('one_time', 'recurring', 'scheduled');--> statement-breakpoint
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
ALTER TABLE "asset_transactions" ADD CONSTRAINT "asset_transactions_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_transactions" ADD CONSTRAINT "asset_transactions_scenario_id_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."scenarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_transactions" ADD CONSTRAINT "asset_transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_transactions" ADD CONSTRAINT "asset_transactions_proceeds_account_id_accounts_id_fk" FOREIGN KEY ("proceeds_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_transactions" ADD CONSTRAINT "asset_transactions_asset_model_portfolio_id_model_portfolios_id_fk" FOREIGN KEY ("asset_model_portfolio_id") REFERENCES "public"."model_portfolios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_transactions" ADD CONSTRAINT "asset_transactions_funding_account_id_accounts_id_fk" FOREIGN KEY ("funding_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_schedules" ADD CONSTRAINT "transfer_schedules_transfer_id_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."transfers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_scenario_id_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."scenarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_source_account_id_accounts_id_fk" FOREIGN KEY ("source_account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_target_account_id_accounts_id_fk" FOREIGN KEY ("target_account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;