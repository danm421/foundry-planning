-- Add roth_value column. For 401k / 403b accounts this stores the
-- Roth-designated portion of `value` (defaults to 0 = pure pre-tax).
ALTER TABLE "accounts" ADD COLUMN "roth_value" numeric(15, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint

-- Cast sub_type to text so we can rewrite roth_401k / roth_403b rows
-- without bumping into the enum constraint we're about to drop.
ALTER TABLE "accounts" ALTER COLUMN "sub_type" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "sub_type" SET DEFAULT 'other'::text;--> statement-breakpoint
ALTER TABLE "asset_transactions" ALTER COLUMN "asset_sub_type" SET DATA TYPE text;--> statement-breakpoint

-- Consolidate the four 401(k)/403(b) subtypes into two: rothValue captures
-- the Roth-designated balance. Any pre-existing `basis` on these subtypes
-- was incorrectly applied to Roth conversions — zero it out.
UPDATE "accounts"
   SET "sub_type" = '401k',
       "roth_value" = "value",
       "basis" = '0'
 WHERE "sub_type" = 'roth_401k';--> statement-breakpoint
UPDATE "accounts"
   SET "sub_type" = '403b',
       "roth_value" = "value",
       "basis" = '0'
 WHERE "sub_type" = 'roth_403b';--> statement-breakpoint
UPDATE "accounts"
   SET "basis" = '0'
 WHERE "sub_type" IN ('401k', '403b');--> statement-breakpoint

-- asset_transactions.asset_sub_type uses the same enum; rewrite there too.
UPDATE "asset_transactions" SET "asset_sub_type" = '401k' WHERE "asset_sub_type" = 'roth_401k';--> statement-breakpoint
UPDATE "asset_transactions" SET "asset_sub_type" = '403b' WHERE "asset_sub_type" = 'roth_403b';--> statement-breakpoint

-- The check_retirement_account_owner() trigger function (originally seeded
-- in 0055) hard-codes the dropped subtype literals. Refresh it BEFORE we
-- drop the enum — otherwise the function body's reference to 'roth_401k'
-- becomes invalid the moment the enum is recreated, breaking every
-- account_owners insert/update.
CREATE OR REPLACE FUNCTION check_retirement_account_owner() RETURNS trigger AS $func$
DECLARE
  acct_id UUID;
  is_retirement BOOLEAN;
  cnt INT;
  max_pct NUMERIC;
BEGIN
  acct_id := COALESCE(NEW.account_id, OLD.account_id);
  SELECT sub_type IN ('traditional_ira', 'roth_ira', '401k', '403b')
    INTO is_retirement FROM accounts WHERE id = acct_id;
  IF NOT is_retirement THEN RETURN NULL; END IF;
  SELECT COUNT(*), MAX(percent) INTO cnt, max_pct FROM account_owners WHERE account_id = acct_id;
  IF cnt > 1 OR max_pct < 1.0 THEN
    RAISE EXCEPTION 'Retirement account % requires exactly one owner at 100%% (got % rows, max pct %)', acct_id, cnt, max_pct;
  END IF;
  RETURN NULL;
END;
$func$ LANGUAGE plpgsql;--> statement-breakpoint

-- Recreate the enum without the dropped values.
DROP TYPE "public"."account_sub_type";--> statement-breakpoint
CREATE TYPE "public"."account_sub_type" AS ENUM('brokerage', 'savings', 'checking', 'traditional_ira', 'roth_ira', '401k', '403b', '529', 'trust', 'other', 'primary_residence', 'rental_property', 'commercial_property', 'sole_proprietorship', 'partnership', 's_corp', 'c_corp', 'llc', 'term', 'whole_life', 'universal_life', 'variable_life');--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "sub_type" SET DEFAULT 'other'::"public"."account_sub_type";--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "sub_type" SET DATA TYPE "public"."account_sub_type" USING "sub_type"::"public"."account_sub_type";--> statement-breakpoint
ALTER TABLE "asset_transactions" ALTER COLUMN "asset_sub_type" SET DATA TYPE "public"."account_sub_type" USING "asset_sub_type"::"public"."account_sub_type";
