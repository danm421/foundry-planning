ALTER TABLE "gifts" DROP CONSTRAINT "gifts_event_kind";--> statement-breakpoint
ALTER TABLE "gifts" ADD COLUMN "business_entity_id" uuid;--> statement-breakpoint
ALTER TABLE "gifts" ADD CONSTRAINT "gifts_business_entity_id_entities_id_fk" FOREIGN KEY ("business_entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gifts" ADD CONSTRAINT "gifts_event_kind" CHECK ((
        ("gifts"."amount" IS NOT NULL AND "gifts"."account_id" IS NULL AND "gifts"."liability_id" IS NULL AND "gifts"."percent" IS NULL AND "gifts"."business_entity_id" IS NULL)
        OR
        (("gifts"."account_id" IS NOT NULL OR "gifts"."liability_id" IS NOT NULL)
         AND "gifts"."percent" IS NOT NULL
         AND NOT ("gifts"."account_id" IS NOT NULL AND "gifts"."liability_id" IS NOT NULL)
         AND "gifts"."business_entity_id" IS NULL)
        OR
        ("gifts"."business_entity_id" IS NOT NULL AND "gifts"."percent" IS NOT NULL AND "gifts"."account_id" IS NULL AND "gifts"."liability_id" IS NULL)
      ));