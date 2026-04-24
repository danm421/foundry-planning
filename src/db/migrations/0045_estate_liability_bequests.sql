CREATE TYPE "public"."will_bequest_kind" AS ENUM('asset', 'liability');

--> statement-breakpoint

ALTER TABLE "will_bequests" ALTER COLUMN "asset_mode" DROP NOT NULL;

--> statement-breakpoint

-- Add kind with a DEFAULT so existing rows backfill, then drop the default
-- so future inserts must specify kind explicitly.
ALTER TABLE "will_bequests" ADD COLUMN "kind" "will_bequest_kind" NOT NULL DEFAULT 'asset';
ALTER TABLE "will_bequests" ALTER COLUMN "kind" DROP DEFAULT;

--> statement-breakpoint

ALTER TABLE "will_bequests" ADD COLUMN "liability_id" uuid;
ALTER TABLE "will_bequests"
  ADD CONSTRAINT "will_bequests_liability_id_liabilities_id_fk"
  FOREIGN KEY ("liability_id") REFERENCES "public"."liabilities"("id")
  ON DELETE cascade ON UPDATE no action;

--> statement-breakpoint

ALTER TABLE "will_bequests"
  ADD CONSTRAINT "will_bequests_kind_shape_check" CHECK (
    ("kind" = 'asset'
       AND "asset_mode" IS NOT NULL
       AND "liability_id" IS NULL)
    OR
    ("kind" = 'liability'
       AND "asset_mode" IS NULL
       AND "account_id" IS NULL
       AND "liability_id" IS NOT NULL
       AND "condition" = 'always')
  );

--> statement-breakpoint

CREATE UNIQUE INDEX "will_bequests_liability_idx"
  ON "will_bequests" USING btree ("will_id","liability_id")
  WHERE "will_bequests"."kind" = 'liability';
