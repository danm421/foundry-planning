-- Allow an income/expense to compound inflation from a year that's earlier than when
-- the entry itself starts, so advisors can enter "retirement living expenses in
-- today's dollars" — the $80k priced today grows to (80k × (1+infl)^yearsUntilStart)
-- by the time the entry actually starts.
-- Null keeps the current behavior: inflation compounds from the entry's start_year.
ALTER TABLE "incomes" ADD COLUMN "inflation_start_year" integer;
ALTER TABLE "expenses" ADD COLUMN "inflation_start_year" integer;
