ALTER TABLE "asset_transactions" ADD COLUMN "annual_property_tax" numeric(15, 2);--> statement-breakpoint
ALTER TABLE "asset_transactions" ADD COLUMN "property_tax_growth_rate" numeric(5, 4);--> statement-breakpoint
ALTER TABLE "asset_transactions" ADD COLUMN "property_tax_growth_source" "item_growth_source";--> statement-breakpoint
ALTER TABLE "asset_transactions" ADD CONSTRAINT "asset_transactions_buy_only_property_tax_check" CHECK ("asset_transactions"."type" <> 'sell' OR (
      "asset_transactions"."annual_property_tax" IS NULL AND
      "asset_transactions"."property_tax_growth_rate" IS NULL AND
      "asset_transactions"."property_tax_growth_source" IS NULL
    ));