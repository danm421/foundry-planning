CREATE TYPE "public"."li_schedule_mode" AS ENUM('off', 'scheduled');--> statement-breakpoint
ALTER TABLE "life_insurance_cash_value_schedule" ALTER COLUMN "cash_value" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "life_insurance_cash_value_schedule" ADD COLUMN "premium_amount" numeric(15, 2);--> statement-breakpoint
ALTER TABLE "life_insurance_cash_value_schedule" ADD COLUMN "income" numeric(15, 2);--> statement-breakpoint
ALTER TABLE "life_insurance_cash_value_schedule" ADD COLUMN "death_benefit" numeric(15, 2);--> statement-breakpoint
ALTER TABLE "life_insurance_policies" ADD COLUMN "premium_schedule_mode" "li_schedule_mode" DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "life_insurance_policies" ADD COLUMN "death_benefit_schedule_mode" "li_schedule_mode" DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "life_insurance_policies" ADD COLUMN "income_schedule_mode" "li_schedule_mode" DEFAULT 'off' NOT NULL;