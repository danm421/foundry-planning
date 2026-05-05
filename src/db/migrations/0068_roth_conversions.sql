CREATE TYPE "public"."roth_conversion_type" AS ENUM('fixed_amount', 'full_account', 'deplete_over_period', 'fill_up_bracket');--> statement-breakpoint
CREATE TABLE "roth_conversion_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"roth_conversion_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roth_conversions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"scenario_id" uuid NOT NULL,
	"name" text NOT NULL,
	"destination_account_id" uuid NOT NULL,
	"conversion_type" "roth_conversion_type" DEFAULT 'fixed_amount' NOT NULL,
	"fixed_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"fill_up_bracket" numeric(5, 4),
	"start_year" integer NOT NULL,
	"start_year_ref" "year_ref",
	"end_year" integer,
	"end_year_ref" "year_ref",
	"indexing_rate" numeric(5, 4) DEFAULT '0' NOT NULL,
	"inflation_start_year" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "roth_conversion_sources" ADD CONSTRAINT "roth_conversion_sources_roth_conversion_id_roth_conversions_id_fk" FOREIGN KEY ("roth_conversion_id") REFERENCES "public"."roth_conversions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roth_conversion_sources" ADD CONSTRAINT "roth_conversion_sources_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roth_conversions" ADD CONSTRAINT "roth_conversions_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roth_conversions" ADD CONSTRAINT "roth_conversions_scenario_id_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."scenarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roth_conversions" ADD CONSTRAINT "roth_conversions_destination_account_id_accounts_id_fk" FOREIGN KEY ("destination_account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;