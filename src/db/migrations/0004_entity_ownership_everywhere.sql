-- Extend entity ownership to incomes, expenses, and liabilities.
-- Null = owned by the household (client/spouse/joint or no owner concept).
-- Set = owned by a non-individual entity; treated as out of estate.

ALTER TABLE "incomes" ADD COLUMN "owner_entity_id" uuid REFERENCES "entities"("id") ON DELETE SET NULL;
ALTER TABLE "expenses" ADD COLUMN "owner_entity_id" uuid REFERENCES "entities"("id") ON DELETE SET NULL;
ALTER TABLE "liabilities" ADD COLUMN "owner_entity_id" uuid REFERENCES "entities"("id") ON DELETE SET NULL;
