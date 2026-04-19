ALTER TABLE "incomes" ADD COLUMN "ss_benefit_mode" text;--> statement-breakpoint
ALTER TABLE "incomes" ADD COLUMN "pia_monthly" numeric(15, 2);--> statement-breakpoint
ALTER TABLE "incomes" ADD COLUMN "claiming_age_months" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "incomes" ADD COLUMN "claiming_age_mode" text;