CREATE TYPE "public"."savings_salary_basis" AS ENUM('owner', 'all', 'selected');--> statement-breakpoint
CREATE TABLE "savings_rule_salary_incomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"savings_rule_id" uuid NOT NULL,
	"income_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "savings_rule_salary_incomes_uniq" UNIQUE("savings_rule_id","income_id")
);
--> statement-breakpoint
ALTER TABLE "savings_rules" ADD COLUMN "salary_basis" "savings_salary_basis" DEFAULT 'owner' NOT NULL;--> statement-breakpoint
ALTER TABLE "savings_rule_salary_incomes" ADD CONSTRAINT "savings_rule_salary_incomes_savings_rule_id_savings_rules_id_fk" FOREIGN KEY ("savings_rule_id") REFERENCES "public"."savings_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "savings_rule_salary_incomes" ADD CONSTRAINT "savings_rule_salary_incomes_income_id_incomes_id_fk" FOREIGN KEY ("income_id") REFERENCES "public"."incomes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "savings_rule_salary_incomes_rule_sort_idx" ON "savings_rule_salary_incomes" USING btree ("savings_rule_id","sort_order");