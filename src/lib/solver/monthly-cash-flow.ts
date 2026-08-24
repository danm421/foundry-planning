import type { ClientData, ProjectionYear } from "@/engine";
import type { AccountOwner } from "@/engine/ownership";
import { LIQUID_PORTFOLIO_CATEGORIES } from "@/engine/portfolio-snapshot";
import { ageLabel } from "./cashflow-year-detail";

/** Nominal = the engine's own future dollars. Today = deflated to plan-start
 *  purchasing power, which is the only unit a household reasons in. */
export type DollarBasis = "today" | "nominal";

const MONTHS_PER_YEAR = 12;

/** Costs the household has already committed. Living expenses are deliberately
 *  absent — they are what the leftover PAYS FOR, not something taken off it. */
export interface MonthlyFixedCosts {
  taxes: number;
  liabilities: number;
  savings: number;
  insurance: number;
  realEstate: number;
  other: number;
  total: number;
}

export interface MonthlyCashFlowRow {
  year: number;
  ageLabel: string;
  /** Monthly income. Excludes any portfolio draw — that is its own line. */
  income: number;
  fixed: MonthlyFixedCosts;
  /** income − fixed.total. Negative in most retirement years, and that is the
   *  honest signal rather than an error state. */
  leftAfterFixed: number;
  /** Household supplemental withdrawals only. `entityWithdrawals` are trust and
   *  business internal refills — not household money, never counted here. */
  portfolioDraw: number;
  /** The household's whole monthly lifestyle budget, living expenses included. */
  available: number;
  split: MonthlyAvailableSplit;
  /** True when `available` is money that does not exist: the household's liquid
   *  portfolio finished the year below zero and the engine kept paying anyway.
   *  Rendered as a hard flag on the chart, the table row and the hero card. */
  depleted: boolean;
}

/** Where the available money actually goes today. The three named parts each
 *  come from the engine directly; `unexplained` is whatever they cannot account
 *  for and is always shown as its own row — never folded into `available`. A
 *  leftover number that doubles as a dumping ground is worse than no number. */
export interface MonthlyAvailableSplit {
  living: number;
  surplusSpent: number;
  surplusUnspent: number;
  unexplained: number;
}

/**
 * The surplus the household did not spend — transferred to a savings
 * destination, or left sitting in checking.
 *
 * POSITIVE AMOUNTS ONLY, and that is load-bearing. `surplus_transfer` is booked
 * as two legs: −saveAmount debited from checking (projection.ts:7175) and
 * +saveAmount credited to the destination (:7200). Summing both nets to zero
 * and silently reports "nothing saved" for every plan with a save destination.
 * `surplus_retained` is a single positive leg on checking (:7215).
 */
function surplusUnspentAnnual(y: ProjectionYear): number {
  let total = 0;
  for (const ledger of Object.values(y.accountLedgers)) {
    for (const entry of ledger.entries) {
      if (entry.category !== "surplus_transfer" && entry.category !== "surplus_retained") {
        continue;
      }
      if (entry.amount > 0) total += entry.amount;
    }
  }
  return total;
}

/**
 * The accounts whose ending balance is household spendable money.
 *
 * Liquid only, using the engine's own `LIQUID_PORTFOLIO_CATEGORIES` rather than
 * a second hand-maintained list: real estate, business and stock options are net
 * worth the engine will never draw on, so a $750k house must not make an
 * exhausted portfolio look solvent.
 *
 * Ownership is "has a family-member owner and no entity owner". Deliberately NOT
 * `controllingFamilyMember` — that requires a single owner at 100%, so it drops
 * every jointly-owned account, i.e. most real ones, and silences the flag on a
 * portfolio that is millions underwater.
 *
 * `syntheticAccounts` are engine-minted equity destination accounts holding real
 * household money that never appear in `clientData.accounts`. Omitting them
 * under-counts the balance, which is the dangerous direction: it flags a
 * household that is fine.
 */
function householdLiquidAccountIds(
  years: ProjectionYear[],
  clientData: ClientData,
): Set<string> {
  const candidates: Array<{ id: string; category: string; owners: AccountOwner[] }> = [
    ...clientData.accounts,
    ...years.flatMap((y) => y.syntheticAccounts ?? []),
  ];
  const ids = new Set<string>();
  for (const a of candidates) {
    if (!LIQUID_PORTFOLIO_CATEGORIES.has(a.category)) continue;
    // `owners` is required on `Account`, but a partially un-normalized
    // clientData can still reach here with it undefined. Falling back to []
    // SHRINKS the household set, which is the dangerous direction: a missing
    // balance makes a solvent household look broke. Preferred over `?? [{...}]`
    // only because inventing an owner is worse than under-counting one.
    const owners = a.owners ?? [];
    if (!owners.some((o) => o.kind === "family_member")) continue;
    if (owners.some((o) => o.kind === "entity")) continue;
    ids.add(a.id);
  }
  return ids;
}

/**
 * Engine residue the depletion flag tolerates before it calls a household broke.
 * NOT a tuned threshold — it is the size of a known engine artefact, and it is
 * PROPORTIONAL because the artefact is.
 *
 * Mechanism, read at `projection.ts:5849-5850`: the phase-12 gap-fill runs at
 * most `MAX_ITER = 5` Newton steps and breaks early only on an ABSOLUTE
 * `|checkingAfterTax| <= TOLERANCE` of 1. So the undershoot is capped at a
 * dollar ONLY when the loop converges; when it does not, the loop exits still
 * carrying a RELATIVE error on the amount it was filling, and that error is
 * unbounded in dollars.
 *
 * Which means the residue tracks the YEAR'S SPENDING, not the portfolio.
 * Measured on the narrow-set fixture, worst end-of-year checking balance:
 *
 *  · portfolio 100x at fixed $2M spending — -$5.33 ($100M), -$0.04 ($500M),
 *    -$0.78 ($2.5B), -$1.30 ($10B). Flat and noisy; it does NOT grow.
 *  · spending 2500x at a fixed portfolio — -7e-12 ($80k), -$0.33 ($400k),
 *    -$1.30 ($2M), -$35.53 ($10M), -$1,436 ($200M). Order of magnitude follows.
 *
 * Against the year's own outflow every measured residue lands at or below
 * ~3.8e-6: -$5.33/$3.91M, -$63.36/$19.1M, -$352.64/$95.0M, -$1,436/$379.7M.
 * The first genuinely depleted year is -$92,483 against a $174,823 outflow —
 * a ratio of 0.53. So 0.001 sits ~260x above the worst measured noise and
 * ~500x below the real signal.
 *
 * A flat $10 was tried first and is ALREADY BREACHED in range: a $500M
 * brokerage against $10M-a-year spending leaves -$63.36 in a single year of
 * thirty while the brokerage runs $520M to $1.72B. `DEPLETION_TOLERANCE_DOLLARS`
 * survives only as the floor for a near-zero-outflow year, where a fraction of
 * nothing is nothing.
 */
const DEPLETION_TOLERANCE_DOLLARS = 10;
const DEPLETION_TOLERANCE_FRACTION = 0.001;

/**
 * True when the household's whole liquid portfolio ends the year below zero.
 *
 * When the money runs out the engine does not cut spending — it overdrafts and
 * keeps paying, either as the M14 "unfunded remainder" against the last-drawn
 * account (`projection.ts:6672-6702`) or by letting checking itself finish
 * negative once the gap-fill has nothing left to refill it from. Either way the
 * household's liquid total goes underwater and stays there.
 *
 * Measured on a SINGLE account this is a false-positive machine, which is why
 * it is measured across the portfolio: a self-funding plan that owns a default
 * checking account ends nine of its thirty years with checking below zero — once
 * by $3.29 (the gap-fill converges to the engine's own $1 TOLERANCE), otherwise
 * by ~1e-11 of float dust — while holding $3-5M in liquid assets. Summed, those
 * same years are $3.4M to $4.9M in the black. Across six self-funding fixtures
 * the smallest liquid total measured was +$1,147,000, and the first genuinely
 * depleted year was -$92,483.
 *
 * Summing does NOT remove the residue, it only hides it behind a wide account
 * set. Whenever the set NARROWS to one account — Ruling 5 excludes mixed
 * household/entity accounts wholesale, so a household holding checking plus one
 * 50/50 client/trust brokerage is down to checking alone — the residue is once
 * again the whole sum, and an unpadded `< 0` flags a household with $21M in the
 * bank. Hence the tolerance; see `DEPLETION_TOLERANCE_FRACTION` for why it is a
 * fraction of the year's outflow rather than a flat dollar figure.
 *
 * Structural on purpose. The same code writes a ledger entry labelled "Unfunded
 * shortfall (accounts depleted)", but matching that string would break the
 * moment someone rewords it — and the checking-overdraft path writes no entry
 * at all, so a label match would miss it entirely.
 */
function isDepleted(y: ProjectionYear, householdLiquidIds: Set<string>): boolean {
  let net = 0;
  for (const id of householdLiquidIds) net += y.accountLedgers[id]?.endingValue ?? 0;
  // `totalExpenses` is the engine's own outflow side of
  // `netCashFlow = totalIncome - totalExpenses` (projection.ts:7226) and is
  // exactly `expenses.total + savings.total + hypoContribution`. Verified by
  // measurement, not by reading: `expenses.total` ALREADY carries taxes (the
  // per-bucket sum matches it to 0.00 across 30 years, and taxes run up to 36%
  // of it), and savings is NOT in it (23,500/yr of savings shows up only in the
  // 194,500 -> 218,000 step). Adding either by hand would double-count or
  // under-count the very quantity the gap-fill is sized against.
  const tolerance = Math.max(
    DEPLETION_TOLERANCE_DOLLARS,
    DEPLETION_TOLERANCE_FRACTION * y.totalExpenses,
  );
  return net < -tolerance;
}

/** Deflate to plan-start purchasing power. Returns 1 for the nominal basis and
 *  for the plan's own first year, so the near-term figures are untouched. */
function deflator(
  year: number,
  basis: DollarBasis,
  planSettings: ClientData["planSettings"],
): number {
  if (basis === "nominal") return 1;
  const rate = planSettings.inflationRate;
  return 1 / (1 + rate) ** (year - planSettings.planStartYear);
}

export function buildMonthlyCashFlowRows(
  years: ProjectionYear[],
  clientData: ClientData,
  basis: DollarBasis = "today",
): MonthlyCashFlowRow[] {
  const householdLiquidIds = householdLiquidAccountIds(years, clientData);

  return years.map((y) => {
    // One scale factor per year: annual → monthly, then nominal → chosen basis.
    const k = deflator(y.year, basis, clientData.planSettings) / MONTHS_PER_YEAR;

    const fixed: MonthlyFixedCosts = {
      taxes: y.expenses.taxes * k,
      liabilities: y.expenses.liabilities * k,
      savings: y.savings.total * k,
      insurance: y.expenses.insurance * k,
      realEstate: y.expenses.realEstate * k,
      // `expenses.other` already contains cash gifts, exactly once — measured,
      // not assumed; the "cash gifts" test pins it. Do NOT add
      // `expenses.cashGifts` here or a gifting year double-counts the gift.
      other: y.expenses.other * k,
      total: 0,
    };
    fixed.total =
      fixed.taxes +
      fixed.liabilities +
      fixed.savings +
      fixed.insurance +
      fixed.realEstate +
      fixed.other;

    const income = y.totalIncome * k;
    const leftAfterFixed = income - fixed.total;
    const portfolioDraw = y.withdrawals.total * k;
    const available = leftAfterFixed + portfolioDraw;

    const living = y.expenses.living * k;
    const surplusSpent = y.expenses.discretionary * k;
    const surplusUnspent = surplusUnspentAnnual(y) * k;

    const split: MonthlyAvailableSplit = {
      living,
      surplusSpent,
      surplusUnspent,
      unexplained: available - living - surplusSpent - surplusUnspent,
    };

    return {
      year: y.year,
      ageLabel: ageLabel(y),
      income,
      fixed,
      leftAfterFixed,
      portfolioDraw,
      available,
      split,
      depleted: isDepleted(y, householdLiquidIds),
    };
  });
}
