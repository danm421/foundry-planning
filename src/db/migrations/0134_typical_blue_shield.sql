ALTER TYPE "public"."growth_source" ADD VALUE 'holdings';--> statement-breakpoint
CREATE TABLE "account_holdings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"security_id" uuid,
	"display_ticker" text,
	"display_name" text,
	"shares" numeric(18, 6) DEFAULT '0' NOT NULL,
	"price" numeric(15, 4) DEFAULT '0' NOT NULL,
	"price_as_of" date,
	"cost_basis" numeric(15, 2) DEFAULT '0' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holding_asset_class_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"holding_id" uuid NOT NULL,
	"asset_class_id" uuid NOT NULL,
	"weight" numeric(5, 4) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_holdings" ADD CONSTRAINT "account_holdings_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_holdings" ADD CONSTRAINT "account_holdings_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holding_asset_class_overrides" ADD CONSTRAINT "holding_asset_class_overrides_holding_id_account_holdings_id_fk" FOREIGN KEY ("holding_id") REFERENCES "public"."account_holdings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holding_asset_class_overrides" ADD CONSTRAINT "holding_asset_class_overrides_asset_class_id_asset_classes_id_fk" FOREIGN KEY ("asset_class_id") REFERENCES "public"."asset_classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_holdings_account_idx" ON "account_holdings" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "holding_acw_override_uniq" ON "holding_asset_class_overrides" USING btree ("holding_id","asset_class_id");