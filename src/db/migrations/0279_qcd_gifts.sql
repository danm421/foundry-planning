CREATE TYPE "public"."qcd_amount_mode" AS ENUM('fixed', 'full_rmd');--> statement-breakpoint
ALTER TABLE "gift_series" ADD COLUMN "qcd_account_id" uuid;--> statement-breakpoint
ALTER TABLE "gift_series" ADD COLUMN "qcd_amount_mode" "qcd_amount_mode";--> statement-breakpoint
ALTER TABLE "gifts" ADD COLUMN "qcd_account_id" uuid;--> statement-breakpoint
ALTER TABLE "gifts" ADD COLUMN "qcd_amount_mode" "qcd_amount_mode";--> statement-breakpoint
ALTER TABLE "gift_series" ADD CONSTRAINT "gift_series_qcd_account_id_accounts_id_fk" FOREIGN KEY ("qcd_account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gifts" ADD CONSTRAINT "gifts_qcd_account_id_accounts_id_fk" FOREIGN KEY ("qcd_account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_series" ADD CONSTRAINT "gift_series_qcd_shape" CHECK ((
        ("gift_series"."qcd_account_id" IS NULL AND "gift_series"."qcd_amount_mode" IS NULL)
        OR
        ("gift_series"."qcd_account_id" IS NOT NULL AND "gift_series"."qcd_amount_mode" IS NOT NULL
         AND "gift_series"."recipient_external_beneficiary_id" IS NOT NULL
         AND "gift_series"."grantor" <> 'joint'
         AND "gift_series"."amount_mode" = 'fixed')
      ));--> statement-breakpoint
ALTER TABLE "gifts" ADD CONSTRAINT "gifts_qcd_shape" CHECK ((
        ("gifts"."qcd_account_id" IS NULL AND "gifts"."qcd_amount_mode" IS NULL)
        OR
        ("gifts"."qcd_account_id" IS NOT NULL AND "gifts"."qcd_amount_mode" IS NOT NULL
         AND "gifts"."recipient_external_beneficiary_id" IS NOT NULL
         AND "gifts"."account_id" IS NULL AND "gifts"."liability_id" IS NULL AND "gifts"."business_entity_id" IS NULL
         AND "gifts"."percent" IS NULL AND "gifts"."amount" IS NOT NULL
         AND "gifts"."grantor" <> 'joint')
      ));--> statement-breakpoint
ALTER TABLE "gifts" DROP CONSTRAINT "gifts_amount_positive";--> statement-breakpoint
ALTER TABLE "gifts" ADD CONSTRAINT "gifts_amount_positive" CHECK ("amount" > 0 OR ("amount" = 0 AND "qcd_amount_mode" IS NOT NULL AND "qcd_amount_mode" = 'full_rmd'));