CREATE TYPE "public"."divorce_disposition" AS ENUM('primary', 'spouse', 'split', 'duplicate');--> statement-breakpoint
CREATE TYPE "public"."divorce_plan_status" AS ENUM('draft', 'committed', 'abandoned');--> statement-breakpoint
CREATE TABLE "divorce_plan_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"divorce_plan_id" uuid NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" uuid NOT NULL,
	"disposition" "divorce_disposition" NOT NULL,
	"split_percent_to_spouse" numeric(6, 4),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "divorce_alloc_split_pct" CHECK ((("divorce_plan_allocations"."disposition" = 'split') = ("divorce_plan_allocations"."split_percent_to_spouse" IS NOT NULL))
        AND ("divorce_plan_allocations"."split_percent_to_spouse" IS NULL
          OR ("divorce_plan_allocations"."split_percent_to_spouse" > 0 AND "divorce_plan_allocations"."split_percent_to_spouse" < 100)))
);
--> statement-breakpoint
CREATE TABLE "divorce_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"firm_id" text NOT NULL,
	"status" "divorce_plan_status" DEFAULT 'draft' NOT NULL,
	"primary_filing_status" "filing_status" DEFAULT 'single' NOT NULL,
	"spouse_filing_status" "filing_status" DEFAULT 'single' NOT NULL,
	"spouse_state" text,
	"split_year" integer NOT NULL,
	"beneficiary_cleanup" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"committed_at" timestamp,
	"result_client_id" uuid,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "divorce_plan_allocations" ADD CONSTRAINT "divorce_plan_allocations_divorce_plan_id_divorce_plans_id_fk" FOREIGN KEY ("divorce_plan_id") REFERENCES "public"."divorce_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "divorce_plans" ADD CONSTRAINT "divorce_plans_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "divorce_plans" ADD CONSTRAINT "divorce_plans_result_client_id_clients_id_fk" FOREIGN KEY ("result_client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "divorce_alloc_target_uniq" ON "divorce_plan_allocations" USING btree ("divorce_plan_id","target_kind","target_id");--> statement-breakpoint
CREATE INDEX "divorce_plans_firm_idx" ON "divorce_plans" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "divorce_plans_client_idx" ON "divorce_plans" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "divorce_plans_live_draft_uniq" ON "divorce_plans" USING btree ("client_id") WHERE "divorce_plans"."status" = 'draft';