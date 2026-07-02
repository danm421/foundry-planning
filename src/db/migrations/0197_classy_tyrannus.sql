ALTER TYPE "public"."expense_type" ADD VALUE 'education';--> statement-breakpoint
CREATE TABLE "expense_dedicated_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expense_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "expense_dedicated_accounts_uniq" UNIQUE("expense_id","account_id")
);
--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "pay_shortfall_out_of_pocket" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "institution_state" text;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "institution_name" text;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "for_family_member_id" uuid;--> statement-breakpoint
ALTER TABLE "expense_dedicated_accounts" ADD CONSTRAINT "expense_dedicated_accounts_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_dedicated_accounts" ADD CONSTRAINT "expense_dedicated_accounts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expense_dedicated_accounts_expense_sort_idx" ON "expense_dedicated_accounts" USING btree ("expense_id","sort_order");--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_for_family_member_id_family_members_id_fk" FOREIGN KEY ("for_family_member_id") REFERENCES "public"."family_members"("id") ON DELETE set null ON UPDATE no action;