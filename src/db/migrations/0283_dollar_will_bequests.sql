CREATE TYPE "public"."will_dollar_source" AS ENUM('estate', 'account');--> statement-breakpoint
ALTER TYPE "public"."will_bequest_kind" ADD VALUE 'dollar';--> statement-breakpoint
ALTER TABLE "will_bequests" DROP CONSTRAINT "will_bequests_account_id_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "will_bequest_recipients" ALTER COLUMN "percentage" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "will_bequest_recipients" ADD COLUMN "amount" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "will_bequests" ADD COLUMN "dollar_source" "will_dollar_source";--> statement-breakpoint
ALTER TABLE "will_bequests" ADD COLUMN "fallback_to_estate" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "will_bequests" ADD CONSTRAINT "will_bequests_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "will_bequests" DROP CONSTRAINT "will_bequests_kind_shape_check";--> statement-breakpoint
ALTER TABLE "will_bequests" ADD CONSTRAINT "will_bequests_kind_shape_check" CHECK (
  ("kind"::text = 'asset' AND "liability_id" IS NULL AND "dollar_source" IS NULL AND NOT "fallback_to_estate"
    AND (("asset_mode" = 'specific' AND "account_id" IS NOT NULL) OR ("asset_mode" = 'all_assets' AND "account_id" IS NULL)))
  OR ("kind"::text = 'liability' AND "asset_mode" IS NULL AND "account_id" IS NULL AND "liability_id" IS NOT NULL
    AND "condition" = 'always' AND "dollar_source" IS NULL AND NOT "fallback_to_estate")
  OR ("kind"::text = 'dollar' AND "asset_mode" IS NULL AND "entity_id" IS NULL AND "liability_id" IS NULL AND "dollar_source" IS NOT NULL
    AND (("dollar_source"::text = 'estate' AND "account_id" IS NULL AND NOT "fallback_to_estate")
         OR "dollar_source"::text = 'account'))
);--> statement-breakpoint
ALTER TABLE "will_bequest_recipients" ADD CONSTRAINT "will_bequest_recipients_amount_or_percentage" CHECK (
  ("percentage" IS NOT NULL AND "amount" IS NULL)
  OR ("percentage" IS NULL AND "amount" IS NOT NULL AND "amount" > 0)
);--> statement-breakpoint
CREATE OR REPLACE FUNCTION "drop_percentage_will_gifts_of_deleted_account"() RETURNS trigger AS $$
BEGIN
  DELETE FROM "will_bequests" WHERE "account_id" = OLD."id" AND "kind"::text <> 'dollar';
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "accounts_drop_percentage_will_gifts" BEFORE DELETE ON "accounts"
  FOR EACH ROW EXECUTE FUNCTION "drop_percentage_will_gifts_of_deleted_account"();
