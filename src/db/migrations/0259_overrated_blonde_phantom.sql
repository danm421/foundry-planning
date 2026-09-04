CREATE TYPE "public"."tax_withheld_mode" AS ENUM('none', 'amount', 'percent');--> statement-breakpoint
CREATE TABLE "client_tax_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"scenario_id" uuid NOT NULL,
	"tax_type" "income_tax_type" NOT NULL,
	"name" text,
	"owner" "owner" DEFAULT 'joint' NOT NULL,
	"annual_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"growth_rate" numeric(5, 4) DEFAULT '0' NOT NULL,
	"start_year" integer NOT NULL,
	"end_year" integer NOT NULL,
	"start_year_ref" "year_ref",
	"end_year_ref" "year_ref",
	"withheld_mode" "tax_withheld_mode" DEFAULT 'none' NOT NULL,
	"withheld_value" numeric(15, 4) DEFAULT '0' NOT NULL,
	"source" "source" DEFAULT 'manual' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "client_tax_adjustments" ADD CONSTRAINT "client_tax_adjustments_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_tax_adjustments" ADD CONSTRAINT "client_tax_adjustments_scenario_id_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."scenarios"("id") ON DELETE cascade ON UPDATE no action;