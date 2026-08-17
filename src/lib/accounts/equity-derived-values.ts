// src/lib/accounts/equity-derived-values.ts
//
// A stock_options account's `value` column is written once, as "0", by the
// create route and never updated again — every share the client holds lives in
// `stock_option_grants`, not in the balance. The projection already knows this
// and overwrites the balance in memory each year (`projection.ts`, after the
// growth loop), so anything reading a PROJECTED year is correct. What is wrong
// is every surface that reads the account's own stored value: a $42,000
// position renders as "Stock Options $0".
//
// This is the read-side repair. It is deliberately NOT a write: a stored
// non-zero balance is grown by the projection's growth loop and emits a
// phantom growth entry in Portfolio Activity before `projection.ts` overwrites
// the balance, so persisting the number would also require excluding
// stock_options from that loop. Derive for display; let the engine keep owning
// the number.
//
// Applied inside the two DISPLAY builders — `buildAccountRows` (Net Worth,
// Household Map rows) and `buildMapBoards` (Map boards, portal Organizer,
// presentations deck, Plan Story) — rather than at each page, so a new surface
// built on either one inherits it and cannot render the raw 0.
//
// ⚠️ Whatever consumes the result must not hand it back to a writer. The row
// this produces carries a DERIVED number in a field the scenario editor would
// otherwise persist as data; `buildScenarioDesiredFields` strips `value` for
// stock_options rows for exactly that reason, and the Net Worth value cell is
// read-only on those rows.
import { remainingGrantValue } from "@/engine/equity/valuation";
import type { StockOptionPlan } from "@/engine/equity/types";

/** Substitute each stock_options account's stored value with the value of the
 *  shares still under grant at `planStartYear`.
 *
 *  Priced AT `planStartYear` — a start-of-year, "as of today" figure. The
 *  projection asks the same valuation for `year + 1` because its balances are
 *  stamped grown-through-year-end; a Balance Sheet that did the same would read
 *  a year ahead of every other account beside it.
 *
 *  Keyed by `accountId`, which only stock_options accounts ever have a plan
 *  for, so nothing here needs to test a category. Accounts with no plan are
 *  returned as they came in — including a stock_options account whose grants
 *  have not been entered yet, which is genuinely worth 0.
 *
 *  Returns a new array and never mutates the input: the same tree also feeds
 *  the projection. */
export function withDerivedEquityValues<T extends { id: string; value: number }>(
  accounts: readonly T[],
  stockOptionPlans: readonly StockOptionPlan[] | undefined,
  planStartYear: number,
): T[] {
  if (!stockOptionPlans?.length) return [...accounts];

  const derivedById = new Map(
    stockOptionPlans.map((p) => [
      p.accountId,
      remainingGrantValue(p, planStartYear, planStartYear),
    ]),
  );

  return accounts.map((a) => {
    const derived = derivedById.get(a.id);
    return derived === undefined ? a : { ...a, value: derived };
  });
}
