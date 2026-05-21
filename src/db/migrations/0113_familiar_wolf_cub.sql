ALTER TABLE "entity_owners" DROP CONSTRAINT "entity_owners_uniq";--> statement-breakpoint
ALTER TABLE "entity_owners" ALTER COLUMN "family_member_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "entity_owners" ADD COLUMN "owner_entity_id" uuid;--> statement-breakpoint
ALTER TABLE "entity_owners" ADD CONSTRAINT "entity_owners_owner_entity_id_entities_id_fk" FOREIGN KEY ("owner_entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_owners" ADD CONSTRAINT "entity_owners_uniq" UNIQUE NULLS NOT DISTINCT("entity_id","family_member_id","owner_entity_id");--> statement-breakpoint
ALTER TABLE "entity_owners" ADD CONSTRAINT "entity_owners_one_owner" CHECK (("entity_owners"."family_member_id" IS NOT NULL)::int
        + ("entity_owners"."owner_entity_id" IS NOT NULL)::int = 1);