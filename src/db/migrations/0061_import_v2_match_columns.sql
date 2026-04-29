ALTER TABLE "accounts" ADD COLUMN "account_number_last4" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "custodian" text;--> statement-breakpoint
ALTER TABLE "life_insurance_policies" ADD COLUMN "carrier" text;--> statement-breakpoint
ALTER TABLE "life_insurance_policies" ADD COLUMN "policy_number_last4" text;--> statement-breakpoint
ALTER TABLE "wills" ADD COLUMN "executor" text;--> statement-breakpoint
ALTER TABLE "wills" ADD COLUMN "execution_date" date;