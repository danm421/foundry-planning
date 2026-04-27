BEGIN;

ALTER TABLE "accounts" DROP CONSTRAINT "accounts_owner_entity_id_entities_id_fk";
--> statement-breakpoint
ALTER TABLE "accounts" DROP CONSTRAINT "accounts_owner_family_member_id_family_members_id_fk";
--> statement-breakpoint
ALTER TABLE "liabilities" DROP CONSTRAINT "liabilities_owner_entity_id_entities_id_fk";
--> statement-breakpoint
ALTER TABLE "accounts" DROP COLUMN "owner";--> statement-breakpoint
ALTER TABLE "accounts" DROP COLUMN "owner_entity_id";--> statement-breakpoint
ALTER TABLE "accounts" DROP COLUMN "owner_family_member_id";--> statement-breakpoint
ALTER TABLE "liabilities" DROP COLUMN "owner_entity_id";

COMMIT;
