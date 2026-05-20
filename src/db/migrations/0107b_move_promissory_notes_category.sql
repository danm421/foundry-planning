-- Move existing promissory notes out of the legacy 'taxable' category.
-- Must live in a separate migration file from the ALTER TYPE in 0107a:
-- Postgres won't let a new enum value be referenced in the same transaction
-- as its creation.
UPDATE accounts
SET category = 'notes_receivable'
WHERE sub_type = 'promissory_note' AND category = 'taxable';
