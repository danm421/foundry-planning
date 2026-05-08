ALTER TABLE "incomes" DROP CONSTRAINT "incomes_linked_entity_id_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "incomes" DROP COLUMN "linked_entity_id";