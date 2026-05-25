-- Phase 4: Rename asset_transactions.entity_id → business_account_id and
-- retarget the FK from entities → accounts. Pre-production so any existing
-- rows referencing entities (none expected; entity-business path is being
-- removed in Task 21) would have already been orphaned by the upcoming
-- entity purge. We RENAME rather than DROP+ADD to keep the column history
-- intact across this transition.

-- Drop dependent check + foreign key constraints so we can rename the column.
ALTER TABLE "asset_transactions" DROP CONSTRAINT "asset_transactions_sell_source_check";--> statement-breakpoint
ALTER TABLE "asset_transactions" DROP CONSTRAINT "asset_transactions_buy_no_source_check";--> statement-breakpoint
ALTER TABLE "asset_transactions" DROP CONSTRAINT "asset_transactions_entity_id_entities_id_fk";--> statement-breakpoint

-- Rename the column in place. NULL rows simply carry over.
ALTER TABLE "asset_transactions" RENAME COLUMN "entity_id" TO "business_account_id";--> statement-breakpoint

-- Add the new FK target. ON DELETE SET NULL matches the prior semantics.
ALTER TABLE "asset_transactions" ADD CONSTRAINT "asset_transactions_business_account_id_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- Re-add the check constraints with the renamed column.
ALTER TABLE "asset_transactions" ADD CONSTRAINT "asset_transactions_sell_source_check" CHECK ("asset_transactions"."type" <> 'sell' OR (
      (CASE WHEN "asset_transactions"."account_id" IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN "asset_transactions"."purchase_transaction_id" IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN "asset_transactions"."business_account_id" IS NOT NULL THEN 1 ELSE 0 END)
    ) <= 1);--> statement-breakpoint
ALTER TABLE "asset_transactions" ADD CONSTRAINT "asset_transactions_buy_no_source_check" CHECK ("asset_transactions"."type" <> 'buy' OR ("asset_transactions"."purchase_transaction_id" IS NULL AND "asset_transactions"."account_id" IS NULL AND "asset_transactions"."business_account_id" IS NULL AND "asset_transactions"."fraction_sold" IS NULL));
