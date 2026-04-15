-- Issue 3: Rename clients.name to first_name + last_name
ALTER TABLE "clients" ADD COLUMN "first_name" text;
ALTER TABLE "clients" ADD COLUMN "last_name" text;

-- Migrate existing data: split name on first space
UPDATE "clients" SET
  "first_name" = CASE
    WHEN position(' ' in "name") > 0 THEN substring("name" from 1 for position(' ' in "name") - 1)
    ELSE "name"
  END,
  "last_name" = CASE
    WHEN position(' ' in "name") > 0 THEN substring("name" from position(' ' in "name") + 1)
    ELSE ''
  END;

ALTER TABLE "clients" ALTER COLUMN "first_name" SET NOT NULL;
ALTER TABLE "clients" ALTER COLUMN "last_name" SET NOT NULL;
ALTER TABLE "clients" DROP COLUMN "name";

-- Issue 6: Add new account categories
ALTER TYPE "public"."account_category" ADD VALUE 'real_estate';
ALTER TYPE "public"."account_category" ADD VALUE 'business';
ALTER TYPE "public"."account_category" ADD VALUE 'life_insurance';

-- Issue 6: Add new account sub types
ALTER TYPE "public"."account_sub_type" ADD VALUE 'primary_residence';
ALTER TYPE "public"."account_sub_type" ADD VALUE 'rental_property';
ALTER TYPE "public"."account_sub_type" ADD VALUE 'commercial_property';
ALTER TYPE "public"."account_sub_type" ADD VALUE 'sole_proprietorship';
ALTER TYPE "public"."account_sub_type" ADD VALUE 'partnership';
ALTER TYPE "public"."account_sub_type" ADD VALUE 's_corp';
ALTER TYPE "public"."account_sub_type" ADD VALUE 'c_corp';
ALTER TYPE "public"."account_sub_type" ADD VALUE 'llc';
ALTER TYPE "public"."account_sub_type" ADD VALUE 'term';
ALTER TYPE "public"."account_sub_type" ADD VALUE 'whole_life';
ALTER TYPE "public"."account_sub_type" ADD VALUE 'universal_life';
ALTER TYPE "public"."account_sub_type" ADD VALUE 'variable_life';

-- Issue 7: Add linked_property_id to liabilities
ALTER TABLE "liabilities" ADD COLUMN "linked_property_id" uuid;
ALTER TABLE "liabilities" ADD CONSTRAINT "liabilities_linked_property_id_accounts_id_fk" FOREIGN KEY ("linked_property_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;
