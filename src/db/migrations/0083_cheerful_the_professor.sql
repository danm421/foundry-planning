ALTER TABLE "expenses" ADD COLUMN "is_default" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
-- Backfill: mark existing seeded living-expense rows. The seed in
-- POST /api/clients only ever inserts rows with these exact names, so
-- name + type is a safe identifier for already-seeded clients.
UPDATE "expenses"
SET "is_default" = true
WHERE "type" = 'living'
  AND "name" IN ('Current Living Expenses', 'Retirement Living Expenses');