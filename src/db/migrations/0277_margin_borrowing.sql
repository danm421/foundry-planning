ALTER TABLE "accounts" ADD COLUMN "margin_borrow_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "margin_borrow_start_year" integer;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "margin_borrow_start_year_ref" "year_ref";--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "margin_repay_year" integer;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "margin_repay_year_ref" "year_ref";--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_margin_borrow_taxable_only" CHECK ("accounts"."margin_borrow_enabled" = false OR "accounts"."category" = 'taxable');