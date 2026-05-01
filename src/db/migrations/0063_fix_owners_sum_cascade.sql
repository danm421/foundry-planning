-- Fix sum-check triggers to skip the orphan-owner check when the parent
-- account/liability is itself being deleted in the same transaction.
--
-- 0055 introduced DEFERRABLE INITIALLY DEFERRED constraint triggers on
-- account_owners and liability_owners that raise when SUM(percent) on the
-- parent is NULL ("has no owner rows"). Cascade-deleting an account or
-- liability cascades the owner rows; at commit the deferred trigger queries
-- the empty owner set and raises — even though the parent is also gone.
-- Guard against that by short-circuiting when the parent no longer exists.

CREATE OR REPLACE FUNCTION check_account_owners_sum() RETURNS trigger AS $$
DECLARE
  total NUMERIC;
  acct_id UUID;
BEGIN
  acct_id := COALESCE(NEW.account_id, OLD.account_id);
  IF NOT EXISTS (SELECT 1 FROM accounts WHERE id = acct_id) THEN
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
BEGIN
  liab_id := COALESCE(NEW.liability_id, OLD.liability_id);
  IF NOT EXISTS (SELECT 1 FROM liabilities WHERE id = liab_id) THEN
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
