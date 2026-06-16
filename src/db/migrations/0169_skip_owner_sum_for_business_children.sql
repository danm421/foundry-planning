-- Skip the owner-sum check for child-of-business rows (and parent-deleted rows).
--
-- 0055 created DEFERRABLE INITIALLY DEFERRED constraint triggers on
-- account_owners / liability_owners that raise when SUM(percent) on the parent
-- is NULL ("has no owner rows"). 0063 added a guard so a cascade-DELETE of the
-- parent (which also cascades the owner rows) no longer trips the trigger: when
-- the parent row is gone, the check is skipped.
--
-- This migration handles the REPARENT case 0063 missed. When an account or
-- liability is reparented under a business (parent_account_id set non-null), the
-- write path deletes its owner rows — children inherit ownership via
-- parent_account_id and carry no per-row owners. The owner-row DELETE fires the
-- deferred trigger, which at commit sees zero owner rows and raises, aborting the
-- legitimate reparent (route -> 500; Copilot tool -> graceful failure). The
-- trigger fires from account_owners/liability_owners, but it reads the PARENT
-- row, which the same transaction already updated to set parent_account_id — so
-- at commit the guard sees the post-update state and skips correctly.
--
-- Fix: skip the sum check when the parent row has parent_account_id IS NOT NULL.
-- A single `SELECT parent_account_id IS NOT NULL` also subsumes 0063's guard — a
-- missing parent row yields NULL INTO has_parent, which we treat as "skip" too.

CREATE OR REPLACE FUNCTION check_account_owners_sum() RETURNS trigger AS $$
DECLARE
  total NUMERIC;
  acct_id UUID;
  has_parent BOOLEAN;
BEGIN
  acct_id := COALESCE(NEW.account_id, OLD.account_id);
  SELECT parent_account_id IS NOT NULL INTO has_parent FROM accounts WHERE id = acct_id;
  -- has_parent IS NULL  -> parent row gone (cascade delete) — nothing to check.
  -- has_parent IS TRUE  -> child of a business; ownership is inherited via
  --                        parent_account_id, so zero owner rows is correct.
  IF has_parent IS NULL OR has_parent THEN
    RETURN NULL;
  END IF;
  SELECT SUM(percent) INTO total FROM account_owners WHERE account_id = acct_id;
  IF total IS NULL THEN
    RAISE EXCEPTION 'Account % has no owner rows', acct_id;
  END IF;
  IF ABS(total - 1.0) > 0.0001 THEN
    RAISE EXCEPTION 'Account % ownership sums to %, must be 1.0', acct_id, total;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION check_liability_owners_sum() RETURNS trigger AS $$
DECLARE
  total NUMERIC;
  liab_id UUID;
  has_parent BOOLEAN;
BEGIN
  liab_id := COALESCE(NEW.liability_id, OLD.liability_id);
  SELECT parent_account_id IS NOT NULL INTO has_parent FROM liabilities WHERE id = liab_id;
  -- has_parent IS NULL  -> parent row gone (cascade delete) — nothing to check.
  -- has_parent IS TRUE  -> child of a business; ownership is inherited via
  --                        parent_account_id, so zero owner rows is correct.
  IF has_parent IS NULL OR has_parent THEN
    RETURN NULL;
  END IF;
  SELECT SUM(percent) INTO total FROM liability_owners WHERE liability_id = liab_id;
  IF total IS NULL THEN
    RAISE EXCEPTION 'Liability % has no owner rows', liab_id;
  END IF;
  IF ABS(total - 1.0) > 0.0001 THEN
    RAISE EXCEPTION 'Liability % ownership sums to %, must be 1.0', liab_id, total;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
