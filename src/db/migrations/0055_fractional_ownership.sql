BEGIN;

-- Drizzle-generated DDL: new enums, tables, and role column
CREATE TYPE "public"."family_member_role" AS ENUM('client', 'spouse', 'child', 'other');
CREATE TYPE "public"."owner_kind" AS ENUM('family_member', 'entity');
CREATE TABLE "account_owners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"family_member_id" uuid,
	"entity_id" uuid,
	"percent" numeric(6, 4) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "account_owners_uniq" UNIQUE NULLS NOT DISTINCT("account_id","family_member_id","entity_id"),
	CONSTRAINT "account_owners_one_owner" CHECK (("account_owners"."family_member_id" IS NOT NULL)::int + ("account_owners"."entity_id" IS NOT NULL)::int = 1)
);
CREATE TABLE "liability_owners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"liability_id" uuid NOT NULL,
	"family_member_id" uuid,
	"entity_id" uuid,
	"percent" numeric(6, 4) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "liability_owners_uniq" UNIQUE NULLS NOT DISTINCT("liability_id","family_member_id","entity_id"),
	CONSTRAINT "liability_owners_one_owner" CHECK (("liability_owners"."family_member_id" IS NOT NULL)::int + ("liability_owners"."entity_id" IS NOT NULL)::int = 1)
);
ALTER TABLE "scenario_snapshots" ALTER COLUMN "frozen_by_user_id" SET DATA TYPE text;
ALTER TABLE "family_members" ADD COLUMN "role" "family_member_role" DEFAULT 'other' NOT NULL;
ALTER TABLE "account_owners" ADD CONSTRAINT "account_owners_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "account_owners" ADD CONSTRAINT "account_owners_family_member_id_family_members_id_fk" FOREIGN KEY ("family_member_id") REFERENCES "public"."family_members"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "account_owners" ADD CONSTRAINT "account_owners_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "liability_owners" ADD CONSTRAINT "liability_owners_liability_id_liabilities_id_fk" FOREIGN KEY ("liability_id") REFERENCES "public"."liabilities"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "liability_owners" ADD CONSTRAINT "liability_owners_family_member_id_family_members_id_fk" FOREIGN KEY ("family_member_id") REFERENCES "public"."family_members"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "liability_owners" ADD CONSTRAINT "liability_owners_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;

-- ============================================================
-- Section A: Partial unique index + family_members backfill
-- ============================================================

-- Partial unique index: only one client and one spouse role per client
CREATE UNIQUE INDEX family_members_client_role_uniq
  ON family_members (client_id, role)
  WHERE role IN ('client', 'spouse');

-- Backfill family_members for existing clients
INSERT INTO family_members (client_id, first_name, last_name, role, created_at, updated_at)
SELECT id, first_name, last_name, 'client', NOW(), NOW()
FROM clients
WHERE NOT EXISTS (
  SELECT 1 FROM family_members
  WHERE family_members.client_id = clients.id AND family_members.role = 'client'
);

INSERT INTO family_members (client_id, first_name, last_name, role, created_at, updated_at)
SELECT id, spouse_name, spouse_last_name, 'spouse', NOW(), NOW()
FROM clients
WHERE spouse_name IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM family_members
    WHERE family_members.client_id = clients.id AND family_members.role = 'spouse'
  );

-- ============================================================
-- Section B: account_owners + liability_owners backfill
-- ============================================================

-- 1. Entity-owned accounts (highest precedence)
INSERT INTO account_owners (account_id, entity_id, percent)
SELECT id, owner_entity_id, 1.0
FROM accounts
WHERE owner_entity_id IS NOT NULL;

-- 2. Family-member-owned (UTMA / custodial) — only when not already entity-owned
INSERT INTO account_owners (account_id, family_member_id, percent)
SELECT id, owner_family_member_id, 1.0
FROM accounts
WHERE owner_entity_id IS NULL
  AND owner_family_member_id IS NOT NULL;

-- 3. owner='client' -> client-role family_member
INSERT INTO account_owners (account_id, family_member_id, percent)
SELECT a.id, fm.id, 1.0
FROM accounts a
JOIN family_members fm
  ON fm.client_id = a.client_id AND fm.role = 'client'
WHERE a.owner_entity_id IS NULL
  AND a.owner_family_member_id IS NULL
  AND a.owner = 'client';

-- 4. owner='spouse' -> spouse-role family_member
INSERT INTO account_owners (account_id, family_member_id, percent)
SELECT a.id, fm.id, 1.0
FROM accounts a
JOIN family_members fm
  ON fm.client_id = a.client_id AND fm.role = 'spouse'
WHERE a.owner_entity_id IS NULL
  AND a.owner_family_member_id IS NULL
  AND a.owner = 'spouse';

-- 5. owner='joint' -> two 50/50 family_member rows (client + spouse).
--    If no spouse exists for this client, fall back to client 100%.
INSERT INTO account_owners (account_id, family_member_id, percent)
SELECT a.id, fm.id, 0.5
FROM accounts a
JOIN family_members fm
  ON fm.client_id = a.client_id AND fm.role IN ('client', 'spouse')
WHERE a.owner_entity_id IS NULL
  AND a.owner_family_member_id IS NULL
  AND a.owner = 'joint'
  AND EXISTS (
    SELECT 1 FROM family_members spouse
    WHERE spouse.client_id = a.client_id AND spouse.role = 'spouse'
  );

-- Joint with no spouse -> client 100%
INSERT INTO account_owners (account_id, family_member_id, percent)
SELECT a.id, fm.id, 1.0
FROM accounts a
JOIN family_members fm
  ON fm.client_id = a.client_id AND fm.role = 'client'
WHERE a.owner_entity_id IS NULL
  AND a.owner_family_member_id IS NULL
  AND a.owner = 'joint'
  AND NOT EXISTS (
    SELECT 1 FROM family_members spouse
    WHERE spouse.client_id = a.client_id AND spouse.role = 'spouse'
  );

-- Liabilities: schema only has owner_entity_id (no owner enum, no owner_family_member_id).
-- Engine historically treated non-entity-owned liabilities as household debt with no
-- per-person attribution. Backfill defaults non-entity-owned liabilities to client 100%
-- (preserves household total; advisors can adjust to spouse / joint / mixed via the new UI).

-- 1. Entity-owned liabilities -> entity 100%
INSERT INTO liability_owners (liability_id, entity_id, percent)
SELECT id, owner_entity_id, 1.0 FROM liabilities WHERE owner_entity_id IS NOT NULL;

-- 2. All other liabilities -> client 100% (default)
INSERT INTO liability_owners (liability_id, family_member_id, percent)
SELECT l.id, fm.id, 1.0 FROM liabilities l
JOIN family_members fm ON fm.client_id = l.client_id AND fm.role = 'client'
WHERE l.owner_entity_id IS NULL;

-- ============================================================
-- Section C: Invariant verification
-- ============================================================

DO $$
DECLARE
  orphan_accounts INT;
  orphan_liabilities INT;
  imbalanced_accounts INT;
  imbalanced_liabilities INT;
BEGIN
  SELECT COUNT(*) INTO orphan_accounts FROM accounts a
    WHERE NOT EXISTS (SELECT 1 FROM account_owners WHERE account_id = a.id);
  IF orphan_accounts > 0 THEN
    RAISE EXCEPTION 'Migration 0055: % accounts have no owner rows', orphan_accounts;
  END IF;

  SELECT COUNT(*) INTO orphan_liabilities FROM liabilities l
    WHERE NOT EXISTS (SELECT 1 FROM liability_owners WHERE liability_id = l.id);
  IF orphan_liabilities > 0 THEN
    RAISE EXCEPTION 'Migration 0055: % liabilities have no owner rows', orphan_liabilities;
  END IF;

  SELECT COUNT(*) INTO imbalanced_accounts FROM (
    SELECT account_id FROM account_owners GROUP BY account_id HAVING ABS(SUM(percent) - 1.0) > 0.0001
  ) sub;
  IF imbalanced_accounts > 0 THEN
    RAISE EXCEPTION 'Migration 0055: % accounts have ownership not summing to 100%%', imbalanced_accounts;
  END IF;

  SELECT COUNT(*) INTO imbalanced_liabilities FROM (
    SELECT liability_id FROM liability_owners GROUP BY liability_id HAVING ABS(SUM(percent) - 1.0) > 0.0001
  ) sub;
  IF imbalanced_liabilities > 0 THEN
    RAISE EXCEPTION 'Migration 0055: % liabilities have ownership not summing to 100%%', imbalanced_liabilities;
  END IF;
END $$;

-- ============================================================
-- Section D: Constraint trigger functions + triggers
-- ============================================================

-- Sum-to-100% per account, deferred to end of transaction
CREATE OR REPLACE FUNCTION check_account_owners_sum() RETURNS trigger AS $$
DECLARE
  total NUMERIC;
  acct_id UUID;
BEGIN
  acct_id := COALESCE(NEW.account_id, OLD.account_id);
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

CREATE CONSTRAINT TRIGGER account_owners_sum_check
  AFTER INSERT OR UPDATE OR DELETE ON account_owners
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_account_owners_sum();

CREATE OR REPLACE FUNCTION check_liability_owners_sum() RETURNS trigger AS $$
DECLARE
  total NUMERIC;
  liab_id UUID;
BEGIN
  liab_id := COALESCE(NEW.liability_id, OLD.liability_id);
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

CREATE CONSTRAINT TRIGGER liability_owners_sum_check
  AFTER INSERT OR UPDATE OR DELETE ON liability_owners
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_liability_owners_sum();

-- Retirement-account single-owner constraint
-- Retirement subType values per accountSubTypeEnum: 'traditional_ira', 'roth_ira', '401k', 'roth_401k', '403b', 'roth_403b'
CREATE OR REPLACE FUNCTION check_retirement_account_owner() RETURNS trigger AS $$
DECLARE
  acct_id UUID;
  is_retirement BOOLEAN;
  cnt INT;
  max_pct NUMERIC;
BEGIN
  acct_id := COALESCE(NEW.account_id, OLD.account_id);
  SELECT sub_type IN ('traditional_ira', 'roth_ira', '401k', 'roth_401k', '403b', 'roth_403b')
    INTO is_retirement FROM accounts WHERE id = acct_id;
  IF NOT is_retirement THEN RETURN NULL; END IF;
  SELECT COUNT(*), MAX(percent) INTO cnt, max_pct FROM account_owners WHERE account_id = acct_id;
  IF cnt > 1 OR max_pct < 1.0 THEN
    RAISE EXCEPTION 'Retirement account % requires exactly one owner at 100%% (got % rows, max pct %)', acct_id, cnt, max_pct;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER account_owners_retirement_check
  AFTER INSERT OR UPDATE OR DELETE ON account_owners
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_retirement_account_owner();

-- Default-checking no-mix constraint
CREATE OR REPLACE FUNCTION check_default_checking_owner() RETURNS trigger AS $$
DECLARE
  acct_id UUID;
  is_default BOOLEAN;
  fm_count INT;
  ent_count INT;
BEGIN
  acct_id := COALESCE(NEW.account_id, OLD.account_id);
  SELECT is_default_checking INTO is_default FROM accounts WHERE id = acct_id;
  IF NOT is_default THEN RETURN NULL; END IF;
  SELECT
    COUNT(*) FILTER (WHERE family_member_id IS NOT NULL),
    COUNT(*) FILTER (WHERE entity_id IS NOT NULL)
    INTO fm_count, ent_count
  FROM account_owners WHERE account_id = acct_id;
  IF fm_count > 0 AND ent_count > 0 THEN
    RAISE EXCEPTION 'Default-checking account % cannot mix family_member and entity owners', acct_id;
  END IF;
  IF ent_count > 1 THEN
    RAISE EXCEPTION 'Default-checking account % owned by entity must have exactly one entity owner', acct_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER account_owners_default_checking_check
  AFTER INSERT OR UPDATE OR DELETE ON account_owners
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_default_checking_owner();

COMMIT;
