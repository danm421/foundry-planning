-- Set slug='cash' on the "Cash / Money Market" asset class for all firms.
-- The Investments report uses this slug to identify the cash bucket for the
-- "cash accounts always resolve to 100% Cash" short-circuit in
-- resolveAccountAllocation. Idempotent: skips rows whose slug is already set.
UPDATE "asset_classes" SET "slug" = 'cash'
WHERE "name" = 'Cash / Money Market' AND ("slug" IS NULL OR "slug" = '');
