CREATE TYPE "public"."reinvestment_target" AS ENUM('model_portfolio', 'custom');--> statement-breakpoint
CREATE TABLE "reinvestment_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reinvestment_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reinvestments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"scenario_id" uuid NOT NULL,
	"name" text NOT NULL,
	"year" integer NOT NULL,
	"year_ref" "year_ref",
	"target_type" "reinvestment_target" DEFAULT 'model_portfolio' NOT NULL,
	"model_portfolio_id" uuid,
	"custom_growth_rate" numeric(5, 4),
	"custom_pct_ordinary_income" numeric(5, 4),
	"custom_pct_lt_capital_gains" numeric(5, 4),
	"custom_pct_qualified_dividends" numeric(5, 4),
	"custom_pct_tax_exempt" numeric(5, 4),
	"realize_taxes_on_switch" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reinvestment_accounts" ADD CONSTRAINT "reinvestment_accounts_reinvestment_id_reinvestments_id_fk" FOREIGN KEY ("reinvestment_id") REFERENCES "public"."reinvestments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reinvestment_accounts" ADD CONSTRAINT "reinvestment_accounts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reinvestments" ADD CONSTRAINT "reinvestments_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reinvestments" ADD CONSTRAINT "reinvestments_scenario_id_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."scenarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reinvestments" ADD CONSTRAINT "reinvestments_model_portfolio_id_model_portfolios_id_fk" FOREIGN KEY ("model_portfolio_id") REFERENCES "public"."model_portfolios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reinvestment_accounts_unique" ON "reinvestment_accounts" USING btree ("reinvestment_id","account_id");