// "Start the plan next year": when planSettings.dataYear < planStartYear, the
// window [dataYear, planStartYear) already happened. An amount entered during
// it is the first plan year's amount — a $200,000 salary entered in 2026 shows
// $200,000 in 2027 and grows from 2028.
//
// Every inflation site in the engine reads `inflationStartYear ?? startYear`
// (or `startYear` alone for rows with no inflation base), so one conversion at
// runProjection's entry covers them all. It is not done in the loader: the
// rebased years would leak into the edit forms and get saved.
import type { Account, ClientData, PlanSettings } from "./types";
import { applyAssetPurchases } from "./asset-transactions";
import { applyReinvestments } from "./reinvestments";
import { LEGACY_FM_CLIENT } from "./ownership";

type SkipWindow = Pick<PlanSettings, "planStartYear" | "dataYear">;

function inSkippedYear(year: number, ps: SkipWindow): boolean {
  return ps.dataYear != null && year >= ps.dataYear && year < ps.planStartYear;
}

/** The year a row's amount compounds from. A base year inside the skipped
 *  window moves to the plan start; any other base year is returned unchanged. */
export function inflationBaseYear(baseYear: number, ps: SkipWindow): number {
  return inSkippedYear(baseYear, ps) ? ps.planStartYear : baseYear;
}

/** `data` with every row whose growth base falls in the skipped year rebased to
 *  the plan start. Returns the same object when nothing is skipped; never
 *  mutates its input. One-time rows are untouched — they simply never run. */
export function rebaseSkippedYearRows(data: ClientData): ClientData {
  const ps = data.planSettings;
  if (ps.dataYear == null || ps.dataYear >= ps.planStartYear) return data;
  const start = ps.planStartYear;

  const rebaseInflation = <T extends { startYear: number; inflationStartYear?: number }>(row: T): T =>
    inSkippedYear(row.inflationStartYear ?? row.startYear, ps) ? { ...row, inflationStartYear: start } : row;
  // Recurring rows that compound from startYear alone.
  const rebaseStart = <T extends { startYear: number }>(row: T): T =>
    inSkippedYear(row.startYear, ps) ? { ...row, startYear: start } : row;

  return {
    ...data,
    incomes: data.incomes.map(rebaseInflation),
    expenses: data.expenses.map(rebaseInflation),
    rothConversions: data.rothConversions?.map((c) =>
      c.conversionType === "fixed_amount" ? rebaseInflation(c) : c,
    ),
    taxAdjustments: data.taxAdjustments?.map(rebaseStart),
    deductions: data.deductions?.map(rebaseStart),
    transfers: data.transfers?.map((t) => (t.mode === "recurring" ? rebaseStart(t) : t)),
  };
}

/** `data` with every sale, purchase and reinvestment dated in the skipped year
 *  already done: a sold account (or the sold fraction) and the loans the sale
 *  paid off are gone, a bought asset is held at its price with its mortgage,
 *  and a switch's new growth and realization apply. Nothing is booked — the
 *  cash, tax and gain are assumed already in today's balances. The dated rows
 *  stay on `assetTransactions` / `reinvestments`: the year loop never reaches
 *  their year, and income tied to a sold asset still reads the sale from them.
 *  Returns the same object when nothing is skipped. */
export function applySkippedYearTransactions(data: ClientData): ClientData {
  const ps = data.planSettings;
  if (ps.dataYear == null || ps.dataYear >= ps.planStartYear) return data;
  const inWindow = (t: { year: number; enabled?: boolean }) =>
    t.enabled !== false && inSkippedYear(t.year, ps);
  const transactions = (data.assetTransactions ?? []).filter(inWindow);
  const reinvestments = (data.reinvestments ?? []).filter(inWindow);
  if (transactions.length === 0 && reinvestments.length === 0) return data;

  let accounts = data.accounts.map((a) => ({ ...a }));
  let liabilities = data.liabilities.map((l) => ({ ...l }));
  const ownerFmId =
    (data.familyMembers ?? []).find((m) => m.role === "client")?.id ?? LEGACY_FM_CLIENT;
  const scale = (a: Account, keep: number) => {
    a.value *= keep;
    a.basis *= keep;
    if (a.marginBalance != null) a.marginBalance *= keep;
  };

  const years = [...new Set([...transactions, ...reinvestments].map((t) => t.year))].sort((a, b) => a - b);
  for (const year of years) {
    for (const sale of transactions.filter((t) => t.year === year && t.type === "sell")) {
      const soldId = sale.businessAccountId ?? sale.accountId;
      if (soldId == null || !accounts.some((a) => a.id === soldId)) continue;
      // A business takes every account it holds with it.
      const sold = new Set([soldId]);
      if (sale.businessAccountId != null) {
        for (const a of accounts) if (a.parentAccountId === soldId) sold.add(a.id);
      }
      const fraction = Math.min(1, sale.fractionSold ?? 1);
      if (fraction >= 1) {
        accounts = accounts.filter((a) => !sold.has(a.id));
        liabilities = liabilities.filter(
          (l) =>
            !(l.linkedPropertyId != null && sold.has(l.linkedPropertyId)) &&
            !(sale.businessAccountId != null && l.parentAccountId === soldId),
        );
      } else {
        for (const a of accounts) if (sold.has(a.id)) scale(a, 1 - fraction);
        if (sale.businessAccountId != null) {
          for (const l of liabilities) {
            if (l.parentAccountId !== soldId) continue;
            l.balance *= 1 - fraction;
            l.monthlyPayment *= 1 - fraction;
          }
        }
      }
    }

    // The real purchase step on throwaway balances: it debits the funding
    // account (discarded — the equity already left) and mints the asset and
    // its mortgage exactly as an in-plan purchase would. The mortgage keeps
    // its origination year, so its schedule opens the plan post-payment.
    const purchased = applyAssetPurchases({
      purchases: transactions.filter((t) => t.year === year && t.type === "buy"),
      accounts,
      liabilities,
      accountBalances: {},
      basisMap: {},
      accountLedgers: {},
      year,
      planStartYear: ps.planStartYear,
      defaultCheckingId: "",
      ownerFmId,
    });
    accounts.push(...purchased.newAccounts);
    liabilities.push(...purchased.newLiabilities);

    // The switch itself, with no gain realized.
    applyReinvestments({
      reinvestments: reinvestments
        .filter((r) => r.year === year)
        .map((r) => ({ ...r, realizeTaxesOnSwitch: false })),
      accounts,
      accountBalances: {},
      basisMap: {},
      accountLedgers: {},
      year,
    });
  }

  return { ...data, accounts, liabilities };
}
