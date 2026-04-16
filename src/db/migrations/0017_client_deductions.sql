-- Add deduction_type enum and client_deductions table for itemized
-- deduction line items (charitable, SALT, mortgage interest, etc.).
-- Also flips tax_engine_mode default from 'flat' to 'bracket' and
-- migrates all existing flat rows to bracket since bracket is now the
-- expected default after the foundation has stabilized.

CREATE TYPE "public"."deduction_type" AS ENUM(
  'charitable_cash',
  'charitable_non_cash',
  'salt',
  'mortgage_interest',
  'other_itemized'
);
--> statement-breakpoint

CREATE TABLE "client_deductions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_id" uuid NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
  "scenario_id" uuid NOT NULL REFERENCES "scenarios"("id") ON DELETE CASCADE,
  "type" "deduction_type" NOT NULL,
  "name" text,
  "owner" "owner" NOT NULL DEFAULT 'joint',
  "annual_amount" numeric(15, 2) NOT NULL DEFAULT '0',
  "growth_rate" numeric(5, 4) NOT NULL DEFAULT '0',
  "start_year" integer NOT NULL,
  "end_year" integer NOT NULL,
  "start_year_ref" "year_ref",
  "end_year_ref" "year_ref",
  "source" "source" NOT NULL DEFAULT 'manual',
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX "client_deductions_client_scenario_idx"
  ON "client_deductions" ("client_id", "scenario_id");
--> statement-breakpoint

ALTER TABLE "plan_settings"
  ALTER COLUMN "tax_engine_mode" SET DEFAULT 'bracket';
--> statement-breakpoint

UPDATE "plan_settings"
  SET "tax_engine_mode" = 'bracket'
  WHERE "tax_engine_mode" = 'flat';
