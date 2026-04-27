BEGIN;

CREATE TABLE "gift_series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"scenario_id" uuid NOT NULL,
	"grantor" "owner" NOT NULL,
	"recipient_entity_id" uuid NOT NULL,
	"start_year" integer NOT NULL,
	"start_year_ref" "year_ref",
	"end_year" integer NOT NULL,
	"end_year_ref" "year_ref",
	"annual_amount" numeric(15, 2) NOT NULL,
	"inflation_adjust" boolean DEFAULT false NOT NULL,
	"use_crummey_powers" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "gift_series_year_order" CHECK ("gift_series"."end_year" >= "gift_series"."start_year")
);
--> statement-breakpoint
ALTER TABLE "gifts" ALTER COLUMN "amount" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "gifts" ADD COLUMN "year_ref" "year_ref";--> statement-breakpoint
ALTER TABLE "gifts" ADD COLUMN "account_id" uuid;--> statement-breakpoint
ALTER TABLE "gifts" ADD COLUMN "liability_id" uuid;--> statement-breakpoint
ALTER TABLE "gifts" ADD COLUMN "percent" numeric(6, 4);--> statement-breakpoint
ALTER TABLE "gifts" ADD COLUMN "parent_gift_id" uuid;--> statement-breakpoint
ALTER TABLE "gift_series" ADD CONSTRAINT "gift_series_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_series" ADD CONSTRAINT "gift_series_scenario_id_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."scenarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_series" ADD CONSTRAINT "gift_series_recipient_entity_id_entities_id_fk" FOREIGN KEY ("recipient_entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gift_series_recipient_idx" ON "gift_series" USING btree ("recipient_entity_id");--> statement-breakpoint
CREATE INDEX "gift_series_client_idx" ON "gift_series" USING btree ("client_id");--> statement-breakpoint
ALTER TABLE "gifts" ADD CONSTRAINT "gifts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gifts" ADD CONSTRAINT "gifts_liability_id_liabilities_id_fk" FOREIGN KEY ("liability_id") REFERENCES "public"."liabilities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gifts" ADD CONSTRAINT "gifts_parent_gift_id_fk" FOREIGN KEY ("parent_gift_id") REFERENCES "public"."gifts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gifts_recipient_year_idx" ON "gifts" USING btree ("recipient_entity_id","year");--> statement-breakpoint
CREATE INDEX "gifts_account_year_idx" ON "gifts" USING btree ("account_id","year");--> statement-breakpoint
CREATE INDEX "gifts_liability_year_idx" ON "gifts" USING btree ("liability_id","year");--> statement-breakpoint
ALTER TABLE "gifts" ADD CONSTRAINT "gifts_event_kind" CHECK ((
        ("gifts"."amount" IS NOT NULL AND "gifts"."account_id" IS NULL AND "gifts"."liability_id" IS NULL AND "gifts"."percent" IS NULL)
        OR
        (("gifts"."account_id" IS NOT NULL OR "gifts"."liability_id" IS NOT NULL)
         AND "gifts"."percent" IS NOT NULL
         AND NOT ("gifts"."account_id" IS NOT NULL AND "gifts"."liability_id" IS NOT NULL))
      ));

-- Verification: every existing gift row passes the new CHECK constraint.
DO $$
DECLARE
  bad_count integer;
BEGIN
  SELECT COUNT(*) INTO bad_count
  FROM gifts
  WHERE NOT (
    (amount IS NOT NULL AND account_id IS NULL AND liability_id IS NULL AND percent IS NULL)
    OR
    ((account_id IS NOT NULL OR liability_id IS NOT NULL)
     AND percent IS NOT NULL
     AND NOT (account_id IS NOT NULL AND liability_id IS NOT NULL))
  );
  IF bad_count > 0 THEN
    RAISE EXCEPTION 'Migration 0057: % existing gift rows fail the new gifts_event_kind CHECK', bad_count;
  END IF;
END $$;

COMMIT;
