ALTER TABLE "life_insurance_policies" DROP CONSTRAINT "life_insurance_policies_post_payout_merge_account_id_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "life_insurance_policies" DROP COLUMN "post_payout_merge_account_id";