-- Add year_ref enum and optional start_year_ref / end_year_ref columns to the
-- five tables that have time-bounded entries. These refs let year fields
-- auto-update when client milestones (retirement age, plan end, etc.) change,
-- so advisors don't have to manually adjust every row after editing plan settings.
CREATE TYPE "public"."year_ref" AS ENUM('plan_start', 'plan_end', 'client_retirement', 'spouse_retirement', 'client_end', 'spouse_end', 'client_ss_62', 'client_ss_fra', 'client_ss_70', 'spouse_ss_62', 'spouse_ss_fra', 'spouse_ss_70');
--> statement-breakpoint
ALTER TABLE "incomes" ADD COLUMN "start_year_ref" "year_ref";
--> statement-breakpoint
ALTER TABLE "incomes" ADD COLUMN "end_year_ref" "year_ref";
--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "start_year_ref" "year_ref";
--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "end_year_ref" "year_ref";
--> statement-breakpoint
ALTER TABLE "liabilities" ADD COLUMN "start_year_ref" "year_ref";
--> statement-breakpoint
ALTER TABLE "liabilities" ADD COLUMN "end_year_ref" "year_ref";
--> statement-breakpoint
ALTER TABLE "savings_rules" ADD COLUMN "start_year_ref" "year_ref";
--> statement-breakpoint
ALTER TABLE "savings_rules" ADD COLUMN "end_year_ref" "year_ref";
--> statement-breakpoint
ALTER TABLE "withdrawal_strategies" ADD COLUMN "start_year_ref" "year_ref";
--> statement-breakpoint
ALTER TABLE "withdrawal_strategies" ADD COLUMN "end_year_ref" "year_ref";
