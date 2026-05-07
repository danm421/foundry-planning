CREATE TABLE "entity_owners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"family_member_id" uuid NOT NULL,
	"percent" numeric(6, 4) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "entity_owners_uniq" UNIQUE("entity_id","family_member_id")
);
--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "basis" numeric(15, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "entity_owners" ADD CONSTRAINT "entity_owners_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_owners" ADD CONSTRAINT "entity_owners_family_member_id_family_members_id_fk" FOREIGN KEY ("family_member_id") REFERENCES "public"."family_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- Backfill entity_owners from the legacy owner enum on business-type entities.
-- Trusts are skipped (their grantor/beneficiary structure lives elsewhere).
INSERT INTO "entity_owners" ("entity_id", "family_member_id", "percent")
SELECT e.id, fm.id, 1.0
FROM "entities" e
JOIN "family_members" fm
  ON fm.client_id = e.client_id AND fm.role = 'client'
WHERE e.entity_type IN ('llc', 's_corp', 'c_corp', 'partnership', 'other')
  AND e.owner = 'client'
ON CONFLICT DO NOTHING;--> statement-breakpoint

INSERT INTO "entity_owners" ("entity_id", "family_member_id", "percent")
SELECT e.id, fm.id, 1.0
FROM "entities" e
JOIN "family_members" fm
  ON fm.client_id = e.client_id AND fm.role = 'spouse'
WHERE e.entity_type IN ('llc', 's_corp', 'c_corp', 'partnership', 'other')
  AND e.owner = 'spouse'
ON CONFLICT DO NOTHING;--> statement-breakpoint

INSERT INTO "entity_owners" ("entity_id", "family_member_id", "percent")
SELECT e.id, fm.id, 0.5
FROM "entities" e
JOIN "family_members" fm
  ON fm.client_id = e.client_id AND fm.role IN ('client', 'spouse')
WHERE e.entity_type IN ('llc', 's_corp', 'c_corp', 'partnership', 'other')
  AND e.owner = 'joint'
ON CONFLICT DO NOTHING;