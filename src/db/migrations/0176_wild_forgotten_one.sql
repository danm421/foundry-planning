-- Catch-up migration: the Plaid schema (enum additions, plaid_account_id column,
-- and both indexes) was applied to the live dev + prod DBs out-of-band before
-- this migration was generated (F14-class drift). All statements use IF NOT EXISTS
-- / DO-nothing guards so this is safe to apply even if the DB already has the
-- changes. drizzle-kit generate output was kept so the snapshot advances and
-- future `drizzle-kit migrate` runs don't re-detect these as drift.

-- Advance the enum to match the live DB order (already done on dev + prod).
-- Use DO $$ to no-op if the values already exist.
DO $$
BEGIN
  -- cd
  IF NOT EXISTS (SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'account_sub_type' AND e.enumlabel = 'cd')
  THEN ALTER TYPE "public"."account_sub_type" ADD VALUE 'cd'; END IF;
  -- money_market
  IF NOT EXISTS (SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'account_sub_type' AND e.enumlabel = 'money_market')
  THEN ALTER TYPE "public"."account_sub_type" ADD VALUE 'money_market'; END IF;
  -- sep_ira
  IF NOT EXISTS (SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'account_sub_type' AND e.enumlabel = 'sep_ira')
  THEN ALTER TYPE "public"."account_sub_type" ADD VALUE 'sep_ira'; END IF;
  -- simple_ira
  IF NOT EXISTS (SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'account_sub_type' AND e.enumlabel = 'simple_ira')
  THEN ALTER TYPE "public"."account_sub_type" ADD VALUE 'simple_ira'; END IF;
  -- 401a
  IF NOT EXISTS (SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'account_sub_type' AND e.enumlabel = '401a')
  THEN ALTER TYPE "public"."account_sub_type" ADD VALUE '401a'; END IF;
END $$;

-- Move hsa to the correct ordinal position (already at correct position on live DB;
-- the live enum was built with the right order; nothing to do here for existing DBs).

-- plaid_account_id column
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "plaid_account_id" text;

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS "accounts_plaid_account_uniq"
  ON "accounts" USING btree ("plaid_item_id","plaid_account_id")
  WHERE ("plaid_account_id" IS NOT NULL);

CREATE INDEX IF NOT EXISTS "plaid_items_client_idx"
  ON "plaid_items" USING btree ("client_id");
