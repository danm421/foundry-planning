ALTER TABLE liabilities ADD COLUMN start_month integer NOT NULL DEFAULT 1;
ALTER TABLE liabilities ADD COLUMN balance_as_of_month integer;
ALTER TABLE liabilities ADD COLUMN balance_as_of_year integer;
