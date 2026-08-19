/**
 * Everything the portal's debt paydown calculator needs, in one server pass:
 * the household's real debts mapped onto the simulator's shape, plus whatever
 * setup the client saved last time.
 *
 * Reads through `loadPortalDebt` — the same loader the Accounts screen uses —
 * so the balances here and the balances the client already knows are the same
 * numbers.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { portalCalculatorStates, scenarios } from "@/db/schema";
import { loadPortalDebt } from "@/lib/portal/load-portal-financials";
import type { PortalDebtRow } from "@/lib/portal/contracts";
import {
  createDefaultDebtPaydownState,
  validateDebtPaydownState,
  type DebtPaydownState,
} from "@/lib/calculators/debt-paydown-state";

export const DEBT_PAYDOWN_KEY = "debt-paydown";

export interface PaydownDebtOption {
  id: string;
  name: string;
  balance: number;
  /** Annual FRACTION. Null when we hold no rate for this debt. */
  annualRate: number | null;
  /** Null when we hold no payment for this debt. */
  minimumPayment: number | null;
  liabilityType: string | null;
  /** True when the rate came from the bank's reported APR, not the client. */
  rateFromApr: boolean;
}

export interface DebtPaydownDTO {
  debts: PaydownDebtOption[];
  state: DebtPaydownState;
}

/**
 * `interestRate` and `monthlyPayment` are stored and cleared as a unit (see
 * `PortalDebtRow`), and the rate column is NOT NULL DEFAULT '0'. So the
 * payment is what tells us the rate beside it is real: without that test a
 * genuine 0% promo card is indistinguishable from a debt nobody has entered
 * terms for.
 *
 * Credit cards are included on purpose. The projection engine holds revolving
 * balances flat because card spending is already modelled as expenses — that
 * rule belongs to the projection. A debt paydown calculator that quietly
 * omitted the client's cards would not be one.
 */
export function toPaydownOption(row: PortalDebtRow): PaydownDebtOption {
  const hasTerms = row.monthlyPayment != null && row.monthlyPayment > 0;
  const aprRate = row.aprPercentage != null ? row.aprPercentage / 100 : null;
  const plaidMinimum =
    row.minimumPayment != null && row.minimumPayment > 0 ? row.minimumPayment : null;
  const rawMinimum = hasTerms ? row.monthlyPayment : plaidMinimum;

  // `balance` already carries the household's ownership share (rawBalance *
  // share) — it's the same figure the Accounts screen displays. Neither
  // `monthlyPayment` (client-entered) nor Plaid's `minimumPayment` is scaled
  // that way; both are the full loan's payment. Amortizing a share-scaled
  // balance against an un-scaled payment overstates the payoff speed — a
  // half-owned $300k mortgage would simulate $150k against the full $1,402
  // and show a debt-free date years early. Scale the payment by the same
  // share balance already carries so the two stay consistent. Rates are
  // scale-free and are left untouched.
  const share = row.rawBalance > 0 ? row.balance / row.rawBalance : 1;

  return {
    id: row.id,
    name: row.name,
    balance: row.balance,
    annualRate: hasTerms ? (row.interestRate ?? 0) : aprRate,
    minimumPayment: rawMinimum != null ? rawMinimum * share : null,
    liabilityType: row.liabilityType,
    rateFromApr: !hasTerms && aprRate != null,
  };
}

export async function loadDebtPaydown(clientId: string): Promise<DebtPaydownDTO> {
  const [scenario] = await db
    .select({ id: scenarios.id })
    .from(scenarios)
    .where(and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, true)))
    .limit(1);

  const [rows, saved] = await Promise.all([
    scenario ? loadPortalDebt(clientId, scenario.id) : Promise.resolve([]),
    db
      .select({ state: portalCalculatorStates.state })
      .from(portalCalculatorStates)
      .where(
        and(
          eq(portalCalculatorStates.clientId, clientId),
          eq(portalCalculatorStates.calculatorKey, DEBT_PAYDOWN_KEY),
        ),
      )
      .limit(1),
  ]);

  // A stored payload that no longer validates — an older shape, a hand-edited
  // row — falls back to the defaults rather than 500ing the page. A fresh
  // object every call: the server-lived DEFAULT_DEBT_PAYDOWN_STATE singleton
  // must never be handed out here, or one client's mutations could leak into
  // the next client's default for the lambda's lifetime.
  const parsed = saved[0] ? validateDebtPaydownState(saved[0].state) : null;

  return {
    debts: rows.filter((r) => r.balance > 0).map(toPaydownOption),
    state: parsed?.ok ? parsed.state : createDefaultDebtPaydownState(),
  };
}
