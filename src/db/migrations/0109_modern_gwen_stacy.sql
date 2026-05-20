ALTER TABLE "asset_transactions" DROP CONSTRAINT "asset_transactions_sell_source_check";--> statement-breakpoint
ALTER TABLE "asset_transactions" DROP CONSTRAINT "asset_transactions_buy_no_source_check";--> statement-breakpoint
ALTER TABLE "asset_transactions" ADD COLUMN "entity_id" uuid;--> statement-breakpoint
ALTER TABLE "asset_transactions" ADD CONSTRAINT "asset_transactions_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_transactions" ADD CONSTRAINT "asset_transactions_sell_source_check" CHECK ("asset_transactions"."type" <> 'sell' OR (
      (CASE WHEN "asset_transactions"."account_id" IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN "asset_transactions"."purchase_transaction_id" IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN "asset_transactions"."entity_id" IS NOT NULL THEN 1 ELSE 0 END)
    ) <= 1);--> statement-breakpoint
ALTER TABLE "asset_transactions" ADD CONSTRAINT "asset_transactions_buy_no_source_check" CHECK ("asset_transactions"."type" <> 'buy' OR ("asset_transactions"."purchase_transaction_id" IS NULL AND "asset_transactions"."account_id" IS NULL AND "asset_transactions"."entity_id" IS NULL AND "asset_transactions"."fraction_sold" IS NULL));