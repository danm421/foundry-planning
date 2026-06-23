CREATE TYPE "public"."transaction_type" AS ENUM('income', 'expense', 'transfer');--> statement-breakpoint
ALTER TABLE "plaid_transactions" ADD COLUMN "type" "transaction_type" DEFAULT 'expense' NOT NULL;
--> statement-breakpoint
-- Backfill: income = the transaction's category sits in the seeded 'income' group.
UPDATE "plaid_transactions" AS pt
SET "type" = 'income'
FROM "transaction_categories" AS leaf
JOIN "transaction_categories" AS grp ON grp."id" = leaf."parent_id"
WHERE pt."category_id" = leaf."id" AND grp."slug" = 'income';
--> statement-breakpoint
-- Backfill: transfer = Plaid TRANSFER_* primary OR the 'financial-transfers' leaf
-- (income already claimed above wins over transfer).
UPDATE "plaid_transactions" AS pt
SET "type" = 'transfer'
WHERE pt."type" <> 'income'
  AND (
    pt."pfc_primary" IN ('TRANSFER_IN', 'TRANSFER_OUT')
    OR pt."category_id" IN (
      SELECT "id" FROM "transaction_categories" WHERE "slug" = 'financial-transfers'
    )
  );