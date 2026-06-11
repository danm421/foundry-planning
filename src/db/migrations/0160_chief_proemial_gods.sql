CREATE TABLE "cma_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" text NOT NULL,
	"risk_free_rate" numeric(6, 4) DEFAULT '0.04' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_price_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"security_id" uuid NOT NULL,
	"month" date NOT NULL,
	"adjusted_close" numeric(18, 6) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticker_portfolio_holdings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticker_portfolio_id" uuid NOT NULL,
	"security_id" uuid,
	"display_ticker" text NOT NULL,
	"weight" numeric(5, 4) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticker_portfolio_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticker_portfolio_id" uuid NOT NULL,
	"window_start" date,
	"window_end" date,
	"n_months" integer DEFAULT 0 NOT NULL,
	"ann_arith_mean" numeric(9, 6),
	"ann_geo_return" numeric(9, 6),
	"ann_volatility" numeric(9, 6),
	"downside_deviation" numeric(9, 6),
	"sharpe" numeric(9, 6),
	"sortino" numeric(9, 6),
	"max_drawdown" numeric(9, 6),
	"limiting_ticker" text,
	"computed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticker_portfolios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ticker_portfolios_firm_id_name_unique" UNIQUE("firm_id","name")
);
--> statement-breakpoint
ALTER TABLE "security_price_history" ADD CONSTRAINT "security_price_history_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticker_portfolio_holdings" ADD CONSTRAINT "ticker_portfolio_holdings_ticker_portfolio_id_ticker_portfolios_id_fk" FOREIGN KEY ("ticker_portfolio_id") REFERENCES "public"."ticker_portfolios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticker_portfolio_holdings" ADD CONSTRAINT "ticker_portfolio_holdings_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticker_portfolio_stats" ADD CONSTRAINT "ticker_portfolio_stats_ticker_portfolio_id_ticker_portfolios_id_fk" FOREIGN KEY ("ticker_portfolio_id") REFERENCES "public"."ticker_portfolios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cma_settings_firm_uniq" ON "cma_settings" USING btree ("firm_id");--> statement-breakpoint
CREATE UNIQUE INDEX "security_price_history_uniq" ON "security_price_history" USING btree ("security_id","month");--> statement-breakpoint
CREATE UNIQUE INDEX "ticker_portfolio_holdings_uniq" ON "ticker_portfolio_holdings" USING btree ("ticker_portfolio_id","display_ticker");--> statement-breakpoint
CREATE UNIQUE INDEX "ticker_portfolio_stats_uniq" ON "ticker_portfolio_stats" USING btree ("ticker_portfolio_id");