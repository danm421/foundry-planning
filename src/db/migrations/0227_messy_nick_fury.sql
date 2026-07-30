ALTER TABLE "tax_year_parameters" ADD COLUMN "roth_phaseout_start_mfj" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "tax_year_parameters" ADD COLUMN "roth_phaseout_end_mfj" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "tax_year_parameters" ADD COLUMN "roth_phaseout_start_single" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "tax_year_parameters" ADD COLUMN "roth_phaseout_end_single" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "tax_year_parameters" ADD COLUMN "ira_deduct_covered_start_mfj" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "tax_year_parameters" ADD COLUMN "ira_deduct_covered_end_mfj" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "tax_year_parameters" ADD COLUMN "ira_deduct_covered_start_single" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "tax_year_parameters" ADD COLUMN "ira_deduct_covered_end_single" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "tax_year_parameters" ADD COLUMN "ira_deduct_spousal_start_mfj" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "tax_year_parameters" ADD COLUMN "ira_deduct_spousal_end_mfj" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "tax_year_parameters" ADD COLUMN "student_loan_max_deduction" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "tax_year_parameters" ADD COLUMN "student_loan_phaseout_start_mfj" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "tax_year_parameters" ADD COLUMN "student_loan_phaseout_end_mfj" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "tax_year_parameters" ADD COLUMN "student_loan_phaseout_start_single" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "tax_year_parameters" ADD COLUMN "student_loan_phaseout_end_single" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "tax_year_parameters" ADD COLUMN "ctc_per_child" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "tax_year_parameters" ADD COLUMN "ctc_refundable_max" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "tax_year_parameters" ADD COLUMN "odc_per_dependent" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "tax_year_parameters" ADD COLUMN "savers_credit_tiers_mfj" jsonb;--> statement-breakpoint
ALTER TABLE "tax_year_parameters" ADD COLUMN "savers_credit_tiers_single" jsonb;--> statement-breakpoint
ALTER TABLE "tax_year_parameters" ADD COLUMN "savers_credit_tiers_hoh" jsonb;