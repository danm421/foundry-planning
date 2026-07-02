-- Reclassify legacy retirement/529 rows to the new category. Backfill the
-- designated beneficiary from a sole family-member owner where one exists,
-- then drop ALL owner rows for reclassified accounts (beneficiary fields are
-- authoritative for education_savings; the engine synthesizes a sentinel).
UPDATE accounts SET category = 'education_savings' WHERE sub_type = '529' AND category = 'retirement';

UPDATE accounts a
SET beneficiary_family_member_id = ao.family_member_id
FROM (
  SELECT account_id, MIN(family_member_id::text)::uuid AS family_member_id
  FROM account_owners
  WHERE family_member_id IS NOT NULL
  GROUP BY account_id
  HAVING COUNT(*) = 1
) ao
WHERE a.id = ao.account_id
  AND a.category = 'education_savings'
  AND a.beneficiary_family_member_id IS NULL;

DELETE FROM account_owners
WHERE account_id IN (SELECT id FROM accounts WHERE category = 'education_savings');
