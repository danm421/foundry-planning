-- 1. Create new enum with v2 values
CREATE TYPE "public"."deduction_type_v2" AS ENUM(
  'charitable',
  'above_line',
  'below_line',
  'property_tax'
);
--> statement-breakpoint

-- 2. Migrate client_deductions.type column to the new enum (zero-data-loss)
ALTER TABLE "client_deductions"
  ALTER COLUMN "type" TYPE "deduction_type_v2"
  USING (CASE "type"::text
    WHEN 'charitable_cash'     THEN 'charitable'::deduction_type_v2
    WHEN 'charitable_non_cash' THEN 'charitable'::deduction_type_v2
    WHEN 'salt'                THEN 'property_tax'::deduction_type_v2
    WHEN 'mortgage_interest'   THEN 'below_line'::deduction_type_v2
    WHEN 'other_itemized'      THEN 'below_line'::deduction_type_v2
  END);
--> statement-breakpoint

-- 3. Drop old enum, rename new
DROP TYPE "public"."deduction_type";
--> statement-breakpoint
ALTER TYPE "public"."deduction_type_v2" RENAME TO "deduction_type";
--> statement-breakpoint

-- 4. Add deduction_type to expenses (nullable — most expenses are not deductions)
ALTER TABLE "expenses"
  ADD COLUMN "deduction_type" "deduction_type";
--> statement-breakpoint

-- 5. Add is_interest_deductible to liabilities
ALTER TABLE "liabilities"
  ADD COLUMN "is_interest_deductible" boolean NOT NULL DEFAULT false;
--> statement-breakpoint

-- 6. Add property tax fields to accounts
ALTER TABLE "accounts"
  ADD COLUMN "annual_property_tax" numeric(15, 2) NOT NULL DEFAULT '0';
--> statement-breakpoint
ALTER TABLE "accounts"
  ADD COLUMN "property_tax_growth_rate" numeric(5, 4) NOT NULL DEFAULT '0.03';
