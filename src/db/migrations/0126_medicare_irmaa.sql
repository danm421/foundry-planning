CREATE TYPE "public"."medicare_coverage_type" AS ENUM('original', 'advantage');--> statement-breakpoint
CREATE TABLE "medicare_coverage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"owner" "owner" NOT NULL,
	"enrollment_year" integer,
	"coverage_type" "medicare_coverage_type" DEFAULT 'original' NOT NULL,
	"medigap_monthly_at65" numeric(10, 2),
	"part_d_plan_monthly_at65" numeric(10, 2),
	"prior_year_magi" numeric(15, 2),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "medicare_coverage_unique_owner" UNIQUE("client_id","owner")
);
--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "ends_at_medicare_eligibility_owner" "owner";--> statement-breakpoint
ALTER TABLE "plan_settings" ADD COLUMN "medicare_premium_inflation_rate" numeric(5, 4) DEFAULT '0.05' NOT NULL;--> statement-breakpoint
ALTER TABLE "tax_year_parameters" ADD COLUMN "standard_part_b_premium" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "tax_year_parameters" ADD COLUMN "part_d_national_base" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "tax_year_parameters" ADD COLUMN "irmaa_brackets_mfj" jsonb;--> statement-breakpoint
ALTER TABLE "tax_year_parameters" ADD COLUMN "irmaa_brackets_single" jsonb;--> statement-breakpoint
ALTER TABLE "medicare_coverage" ADD CONSTRAINT "medicare_coverage_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;