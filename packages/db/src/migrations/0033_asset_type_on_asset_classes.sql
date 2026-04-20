ALTER TABLE "asset_classes" ADD COLUMN "asset_type" varchar(32) DEFAULT 'other' NOT NULL;
-- Backfill asset_type for the default seeded classes. Anything unmatched
-- remains at the column default ('other') — admins reclassify via the CMA UI.
UPDATE "asset_classes" SET "asset_type" = 'equities'
  WHERE "name" IN (
    'US Large Cap','US Mid Cap','US Small Cap',
    'Int''l Developed','Emerging Markets','REITs'
  )
     OR "slug" IN ('us_large_cap','us_mid_cap','us_small_cap','intl_developed','emerging_markets','reit','reits')
     OR lower("name") LIKE '%equity%'
     OR lower("name") LIKE '%stock%';

UPDATE "asset_classes" SET "asset_type" = 'taxable_bonds'
  WHERE "name" IN (
    'US Aggregate Bond','US Corporate Bond','TIPS','High Yield Bond'
  )
     OR "slug" IN ('us_aggregate_bond','us_corporate_bond','tips','high_yield_bond')
     OR lower("name") LIKE '%treasury%'
     OR lower("name") LIKE '%corporate bond%'
     OR lower("name") LIKE '%aggregate bond%'
     OR lower("name") LIKE '%high yield%'
     OR lower("name") = 'tips';

UPDATE "asset_classes" SET "asset_type" = 'tax_exempt_bonds'
  WHERE "name" IN ('US Municipal Bond')
     OR "slug" IN ('us_municipal_bond','muni','municipal')
     OR lower("name") LIKE '%muni%'
     OR lower("name") LIKE '%tax-exempt%'
     OR lower("name") LIKE '%tax exempt%';

UPDATE "asset_classes" SET "asset_type" = 'cash'
  WHERE "name" IN ('Cash / Money Market')
     OR "slug" = 'cash'
     OR lower("name") LIKE '%cash%'
     OR lower("name") LIKE '%money market%';
