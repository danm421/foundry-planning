ALTER TABLE "accounts" ADD COLUMN "margin_balance" numeric(15, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "margin_interest_rate" numeric(5, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "margin_call_pct" numeric(5, 4) DEFAULT '0.3' NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_margin_taxable_only" CHECK ("accounts"."margin_balance" = 0 OR "accounts"."category" = 'taxable');