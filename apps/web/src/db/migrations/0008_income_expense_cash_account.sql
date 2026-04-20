-- Each income deposits into a specific cash account, each expense is paid from a
-- specific cash account. When null, the projection engine falls back to the default
-- household (or entity) checking account.
ALTER TABLE "incomes"  ADD COLUMN "cash_account_id" uuid REFERENCES "accounts"("id") ON DELETE SET NULL;
ALTER TABLE "expenses" ADD COLUMN "cash_account_id" uuid REFERENCES "accounts"("id") ON DELETE SET NULL;
