CREATE TYPE "public"."transaction_source" AS ENUM('plaid', 'manual');--> statement-breakpoint
ALTER TABLE "plaid_transactions" ALTER COLUMN "plaid_item_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "plaid_transactions" ALTER COLUMN "plaid_account_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "plaid_transactions" ALTER COLUMN "plaid_transaction_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "plaid_transactions" ADD COLUMN "source" "transaction_source" DEFAULT 'plaid' NOT NULL;