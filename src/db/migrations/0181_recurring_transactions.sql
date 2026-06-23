CREATE TYPE "public"."recurring_cadence" AS ENUM('monthly', 'annually');--> statement-breakpoint
ALTER TYPE "public"."transaction_categorized_by" ADD VALUE 'recurring';--> statement-breakpoint
CREATE TABLE "recurring_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"match_type" "transaction_match_type" NOT NULL,
	"pattern" text NOT NULL,
	"amount_min" numeric(15, 2) NOT NULL,
	"amount_max" numeric(15, 2) NOT NULL,
	"cadence" "recurring_cadence" NOT NULL,
	"due_day" integer,
	"due_month" integer,
	"category_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plaid_transactions" ADD COLUMN "recurring_transaction_id" uuid;--> statement-breakpoint
ALTER TABLE "recurring_transactions" ADD CONSTRAINT "recurring_transactions_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_transactions" ADD CONSTRAINT "recurring_transactions_category_id_transaction_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."transaction_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recurring_transactions_client_idx" ON "recurring_transactions" USING btree ("client_id");--> statement-breakpoint
ALTER TABLE "plaid_transactions" ADD CONSTRAINT "plaid_transactions_recurring_transaction_id_recurring_transactions_id_fk" FOREIGN KEY ("recurring_transaction_id") REFERENCES "public"."recurring_transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plaid_transactions_recurring_idx" ON "plaid_transactions" USING btree ("recurring_transaction_id");