CREATE TABLE "holding_price_refresh_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" varchar(16) DEFAULT 'running' NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"unique_tickers" integer DEFAULT 0 NOT NULL,
	"tickers_priced" integer DEFAULT 0 NOT NULL,
	"tickers_missing" integer DEFAULT 0 NOT NULL,
	"holdings_updated" integer DEFAULT 0 NOT NULL,
	"accounts_resynced" integer DEFAULT 0 NOT NULL,
	"failures" jsonb
);
