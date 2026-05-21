ALTER TABLE "gifts" DROP CONSTRAINT "gifts_event_kind";--> statement-breakpoint
ALTER TABLE "gifts" ADD CONSTRAINT "gifts_event_kind" CHECK ((
        ("gifts"."amount" IS NOT NULL AND "gifts"."account_id" IS NULL AND "gifts"."liability_id" IS NULL AND "gifts"."percent" IS NULL AND "gifts"."business_entity_id" IS NULL)
        OR
        (("gifts"."account_id" IS NOT NULL OR "gifts"."liability_id" IS NOT NULL)
         AND "gifts"."percent" IS NOT NULL
         AND NOT ("gifts"."account_id" IS NOT NULL AND "gifts"."liability_id" IS NOT NULL)
         AND "gifts"."business_entity_id" IS NULL)
        OR
        ("gifts"."business_entity_id" IS NOT NULL AND "gifts"."percent" IS NOT NULL AND "gifts"."account_id" IS NULL AND "gifts"."liability_id" IS NULL AND "gifts"."recipient_entity_id" IS NOT NULL)
      ));