-- Extend the account owner-sum guard (0055 -> 0063 -> 0169) to also skip
-- education_savings (529) accounts.
--
-- 0169 exempted child-of-business rows (ownership inherited via
-- parent_account_id) from the DEFERRABLE INITIALLY DEFERRED trigger that
-- raises "Account % has no owner rows" when account_owners sums to nothing
-- at commit. Task 10 (API writes) makes education_savings accounts carry
-- ZERO account_owners rows by design — the beneficiary_family_member_id /
-- beneficiary_name columns are authoritative instead. Without this exemption,
-- any DELETE of a 529's account_owners rows (e.g. converting an existing
-- owned account's category to education_savings, or clearing a stray legacy
-- row on an existing 529) fires the row-level trigger and aborts the
-- transaction at commit with a raw Postgres error.

CREATE OR REPLACE FUNCTION check_account_owners_sum() RETURNS trigger AS $$
DECLARE
  total NUMERIC;
  acct_id UUID;
  has_parent BOOLEAN;
  is_education_savings BOOLEAN;
BEGIN
  acct_id := COALESCE(NEW.account_id, OLD.account_id);
  SELECT parent_account_id IS NOT NULL, category = 'education_savings'
    INTO has_parent, is_education_savings
    FROM accounts WHERE id = acct_id;
  -- has_parent IS NULL          -> parent row gone (cascade delete) — nothing to check.
  -- has_parent IS TRUE          -> child of a business; ownership inherited via
  --                                 parent_account_id, so zero owner rows is correct.
  -- is_education_savings IS TRUE -> 529; beneficiary fields are authoritative,
  --                                 zero owner rows is correct by design.
  IF has_parent IS NULL OR has_parent OR is_education_savings THEN
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
