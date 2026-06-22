CREATE TYPE "public"."transaction_category_kind" AS ENUM('group', 'category');--> statement-breakpoint
CREATE TYPE "public"."transaction_match_type" AS ENUM('exact', 'contains');--> statement-breakpoint
CREATE TABLE "transaction_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"slug" text,
	"icon" text,
	"color" text DEFAULT 'var(--data-grey)' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"kind" "transaction_category_kind" NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transaction_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"match_type" "transaction_match_type" NOT NULL,
	"pattern" text NOT NULL,
	"category_id" uuid NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transaction_categories" ADD CONSTRAINT "transaction_categories_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_categories" ADD CONSTRAINT "transaction_categories_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."transaction_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_rules" ADD CONSTRAINT "transaction_rules_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_rules" ADD CONSTRAINT "transaction_rules_category_id_transaction_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."transaction_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transaction_categories_client_idx" ON "transaction_categories" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_categories_client_slug_uniq" ON "transaction_categories" USING btree ("client_id","slug") WHERE "transaction_categories"."slug" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "transaction_rules_client_priority_idx" ON "transaction_rules" USING btree ("client_id","priority");--> statement-breakpoint
ALTER TABLE "plaid_transactions" ADD CONSTRAINT "plaid_transactions_category_id_transaction_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."transaction_categories"("id") ON DELETE set null ON UPDATE no action;