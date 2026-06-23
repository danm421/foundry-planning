CREATE TYPE "public"."holding_source" AS ENUM('manual', 'plaid');--> statement-breakpoint
ALTER TYPE "public"."source" ADD VALUE 'plaid';--> statement-breakpoint
CREATE TABLE "account_value_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"as_of_date" date NOT NULL,
	"value" numeric(18, 2) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_holdings" ADD COLUMN "source" "holding_source" DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "account_holdings" ADD COLUMN "plaid_security_id" text;--> statement-breakpoint
ALTER TABLE "account_value_snapshots" ADD CONSTRAINT "account_value_snapshots_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_value_snapshots_acct_date_uniq" ON "account_value_snapshots" USING btree ("account_id","as_of_date");--> statement-breakpoint
CREATE INDEX "account_value_snapshots_acct_idx" ON "account_value_snapshots" USING btree ("account_id");