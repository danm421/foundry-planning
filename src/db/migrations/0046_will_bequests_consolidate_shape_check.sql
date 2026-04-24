-- Consolidate the two overlapping shape constraints on will_bequests into a
-- single authoritative polymorphic-shape invariant.
--
-- The pre-existing will_bequests_asset_mode_account_coupling (added in 0041)
-- is now redundant and misleading: it was written before kind='liability' rows
-- existed, so it passes vacuously for those rows (both disjuncts evaluate to
-- NULL). Meanwhile, the will_bequests_kind_shape_check added in 0043 only
-- asserts asset_mode IS NOT NULL for the asset branch — it doesn't enforce the
-- asset_mode ↔ account_id coupling that the old constraint guaranteed.
--
-- This migration drops both and replaces them with a single check that covers
-- the full invariant for every kind value.

ALTER TABLE "will_bequests" DROP CONSTRAINT "will_bequests_asset_mode_account_coupling";

--> statement-breakpoint

ALTER TABLE "will_bequests" DROP CONSTRAINT "will_bequests_kind_shape_check";

--> statement-breakpoint

ALTER TABLE "will_bequests"
  ADD CONSTRAINT "will_bequests_kind_shape_check" CHECK (
    (
      "kind" = 'asset'
      AND "liability_id" IS NULL
      AND (
        ("asset_mode" = 'specific' AND "account_id" IS NOT NULL)
        OR ("asset_mode" = 'all_assets' AND "account_id" IS NULL)
      )
    )
    OR (
      "kind" = 'liability'
      AND "asset_mode" IS NULL
      AND "account_id" IS NULL
      AND "liability_id" IS NOT NULL
      AND "condition" = 'always'
    )
  );
