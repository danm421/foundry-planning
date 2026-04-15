-- Allow expressing employer match as a flat annual dollar amount in addition to
-- the existing percentage/cap style. When set, it overrides the percentage
-- calculation. Mutual exclusivity is enforced at the application layer — the
-- savings-rule form picks one mode or the other.
ALTER TABLE "savings_rules"
  ADD COLUMN "employer_match_amount" numeric(15, 2);
