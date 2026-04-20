-- 1. Add term columns
ALTER TABLE liabilities ADD COLUMN term_months integer;
ALTER TABLE liabilities ADD COLUMN term_unit text NOT NULL DEFAULT 'annual';

-- 2. Backfill term_months from existing end_year - start_year
UPDATE liabilities SET term_months = (end_year - start_year) * 12;

-- 3. Make term_months NOT NULL
ALTER TABLE liabilities ALTER COLUMN term_months SET NOT NULL;

-- 4. Drop end_year columns
ALTER TABLE liabilities DROP COLUMN end_year;
ALTER TABLE liabilities DROP COLUMN end_year_ref;

-- 5. Create extra_payment_type enum
DO $$ BEGIN
  CREATE TYPE extra_payment_type AS ENUM ('per_payment', 'lump_sum');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 6. Create extra_payments table
CREATE TABLE extra_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  liability_id uuid NOT NULL REFERENCES liabilities(id) ON DELETE CASCADE,
  year integer NOT NULL,
  type extra_payment_type NOT NULL,
  amount decimal(15, 2) NOT NULL,
  created_at timestamp DEFAULT now() NOT NULL,
  updated_at timestamp DEFAULT now() NOT NULL,
  UNIQUE (liability_id, year, type)
);
