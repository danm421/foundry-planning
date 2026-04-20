CREATE TYPE "public"."will_asset_mode" AS ENUM('specific', 'all_assets');--> statement-breakpoint
CREATE TYPE "public"."will_condition" AS ENUM('if_spouse_survives', 'if_spouse_predeceased', 'always');--> statement-breakpoint
CREATE TYPE "public"."will_grantor" AS ENUM('client', 'spouse');--> statement-breakpoint
CREATE TYPE "public"."will_recipient_kind" AS ENUM('family_member', 'external_beneficiary', 'entity', 'spouse');--> statement-breakpoint
CREATE TABLE "will_bequest_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bequest_id" uuid NOT NULL,
	"recipient_kind" "will_recipient_kind" NOT NULL,
	"recipient_id" uuid,
	"percentage" numeric(5, 2) NOT NULL,
	"sort_order" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "will_bequests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"will_id" uuid NOT NULL,
	"name" text NOT NULL,
	"asset_mode" "will_asset_mode" NOT NULL,
	"account_id" uuid,
	"percentage" numeric(5, 2) NOT NULL,
	"condition" "will_condition" NOT NULL,
	"sort_order" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"grantor" "will_grantor" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "will_bequest_recipients" ADD CONSTRAINT "will_bequest_recipients_bequest_id_will_bequests_id_fk" FOREIGN KEY ("bequest_id") REFERENCES "public"."will_bequests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "will_bequests" ADD CONSTRAINT "will_bequests_will_id_wills_id_fk" FOREIGN KEY ("will_id") REFERENCES "public"."wills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "will_bequests" ADD CONSTRAINT "will_bequests_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wills" ADD CONSTRAINT "wills_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "will_bequests_will_sort_idx" ON "will_bequests" USING btree ("will_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "wills_client_grantor_idx" ON "wills" USING btree ("client_id","grantor");
--> statement-breakpoint
ALTER TABLE "will_bequests"
  ADD CONSTRAINT "will_bequests_asset_mode_account_coupling" CHECK (
    (asset_mode = 'specific' AND account_id IS NOT NULL)
    OR (asset_mode = 'all_assets' AND account_id IS NULL)
  );
--> statement-breakpoint
ALTER TABLE "will_bequests"
  ADD CONSTRAINT "will_bequests_percentage_range" CHECK (
    percentage > 0 AND percentage <= 100
  );
--> statement-breakpoint
ALTER TABLE "will_bequest_recipients"
  ADD CONSTRAINT "will_bequest_recipients_kind_id_coupling" CHECK (
    (recipient_kind = 'spouse' AND recipient_id IS NULL)
    OR (recipient_kind <> 'spouse' AND recipient_id IS NOT NULL)
  );
--> statement-breakpoint
ALTER TABLE "will_bequest_recipients"
  ADD CONSTRAINT "will_bequest_recipients_percentage_range" CHECK (
    percentage > 0 AND percentage <= 100
  );