CREATE TYPE "public"."account_business_type" AS ENUM('sole_prop', 'partnership', 's_corp', 'c_corp', 'llc', 'other');--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "business_type" "account_business_type";--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "distribution_policy_percent" numeric(5, 4);--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "flow_mode" "entity_flow_mode" DEFAULT 'annual' NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "business_tax_treatment" "entity_tax_treatment";--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "parent_account_id" uuid;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "owner_account_id" uuid;--> statement-breakpoint
ALTER TABLE "incomes" ADD COLUMN "owner_account_id" uuid;--> statement-breakpoint
ALTER TABLE "liabilities" ADD COLUMN "parent_account_id" uuid;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_parent_account_id_accounts_id_fk" FOREIGN KEY ("parent_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_owner_account_id_accounts_id_fk" FOREIGN KEY ("owner_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incomes" ADD CONSTRAINT "incomes_owner_account_id_accounts_id_fk" FOREIGN KEY ("owner_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "liabilities" ADD CONSTRAINT "liabilities_parent_account_id_accounts_id_fk" FOREIGN KEY ("parent_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_one_owner" CHECK (("expenses"."owner_entity_id" IS NOT NULL)::int + ("expenses"."owner_account_id" IS NOT NULL)::int <= 1);--> statement-breakpoint
ALTER TABLE "incomes" ADD CONSTRAINT "incomes_one_owner" CHECK (("incomes"."owner_entity_id" IS NOT NULL)::int + ("incomes"."owner_account_id" IS NOT NULL)::int <= 1);