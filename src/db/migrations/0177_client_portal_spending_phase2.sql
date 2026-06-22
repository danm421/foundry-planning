CREATE TYPE "public"."liability_type" AS ENUM('mortgage', 'heloc', 'auto', 'student', 'personal', 'credit_card', 'other');--> statement-breakpoint
CREATE TYPE "public"."transaction_categorized_by" AS ENUM('plaid', 'rule', 'manual');--> statement-breakpoint
CREATE TABLE "plaid_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"plaid_item_id" uuid NOT NULL,
	"account_id" uuid,
	"plaid_account_id" text NOT NULL,
	"plaid_transaction_id" text NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"iso_currency_code" text,
	"date" date NOT NULL,
	"authorized_date" date,
	"merchant_name" text,
	"name" text NOT NULL,
	"pfc_primary" text,
	"pfc_detailed" text,
	"pfc_confidence" text,
	"payment_channel" text,
	"pending" boolean DEFAULT false NOT NULL,
	"category_id" uuid,
	"categorized_by" "transaction_categorized_by" DEFAULT 'plaid' NOT NULL,
	"excluded" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "plaid_transactions_plaid_transaction_id_unique" UNIQUE("plaid_transaction_id")
);
--> statement-breakpoint
ALTER TABLE "liabilities" ALTER COLUMN "monthly_payment" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "liabilities" ALTER COLUMN "term_months" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "liabilities" ADD COLUMN "liability_type" "liability_type";--> statement-breakpoint
ALTER TABLE "liabilities" ADD COLUMN "minimum_payment" numeric(15, 2);--> statement-breakpoint
ALTER TABLE "liabilities" ADD COLUMN "statement_balance" numeric(15, 2);--> statement-breakpoint
ALTER TABLE "liabilities" ADD COLUMN "apr_percentage" numeric(6, 4);--> statement-breakpoint
ALTER TABLE "liabilities" ADD COLUMN "next_payment_due_date" date;--> statement-breakpoint
ALTER TABLE "liabilities" ADD COLUMN "plaid_item_id" uuid;--> statement-breakpoint
ALTER TABLE "liabilities" ADD COLUMN "plaid_account_id" text;--> statement-breakpoint
ALTER TABLE "plaid_items" ADD COLUMN "transactions_cursor" text;--> statement-breakpoint
ALTER TABLE "plaid_transactions" ADD CONSTRAINT "plaid_transactions_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plaid_transactions" ADD CONSTRAINT "plaid_transactions_plaid_item_id_plaid_items_id_fk" FOREIGN KEY ("plaid_item_id") REFERENCES "public"."plaid_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plaid_transactions" ADD CONSTRAINT "plaid_transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plaid_transactions_client_date_idx" ON "plaid_transactions" USING btree ("client_id","date");--> statement-breakpoint
CREATE INDEX "plaid_transactions_client_category_idx" ON "plaid_transactions" USING btree ("client_id","category_id");--> statement-breakpoint
CREATE INDEX "plaid_transactions_account_date_idx" ON "plaid_transactions" USING btree ("account_id","date");--> statement-breakpoint
ALTER TABLE "liabilities" ADD CONSTRAINT "liabilities_plaid_item_id_plaid_items_id_fk" FOREIGN KEY ("plaid_item_id") REFERENCES "public"."plaid_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "liabilities_plaid_account_uniq" ON "liabilities" USING btree ("plaid_item_id","plaid_account_id") WHERE "liabilities"."plaid_account_id" IS NOT NULL;