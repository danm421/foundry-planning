// src/lib/presentations/pages/retirement-summary/aggregate.ts
import type { ClientData, ProjectionYear } from "@/engine/types";

// ── Formatting (single source; page-pdf + chart import these) ────────────────
export function fmtUsd(n: number): string {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${Math.round(n)}`;
}
export function fmtPct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

export function birthYear(dob: string | null | undefined): number | null {
  if (!dob) return null;
  const y = Number(dob.slice(0, 4));
  return Number.isFinite(y) ? y : null;
}

export function retirementYearOf(clientData: ClientData): number | null {
  const by = birthYear(clientData.client.dateOfBirth);
  return by == null ? null : by + clientData.client.retirementAge;
}

/** The projection year at retirement, falling back to the first year. Shared by
 *  the "at retirement" snapshot helpers below. */
function retirementYearRow(years: ProjectionYear[], retirementYear: number): ProjectionYear | undefined {
  return years.find((y) => y.year === retirementYear) ?? years[0];
}

// ── Three-point liquid ───────────────────────────────────────────────────────
export interface LiquidThreePoints { now: number; retirement: number; endOfLife: number; }

export function liquidThreePoints(years: ProjectionYear[], retirementYear: number): LiquidThreePoints {
  const now = years[0]?.portfolioAssets.liquidTotal ?? 0;
  const ret = retirementYearRow(years, retirementYear)?.portfolioAssets.liquidTotal ?? 0;
  const eol = years[years.length - 1]?.portfolioAssets.liquidTotal ?? 0;
  return { now, retirement: ret, endOfLife: eol };
}

// ── Portfolio-over-time bars (hero chart) ────────────────────────────────────
export interface PortfolioBar { year: number; cash: number; taxable: number; retirement: number; total: number; }

export function portfolioBars(years: ProjectionYear[]): PortfolioBar[] {
  return years.map((y) => {
    const cash = y.portfolioAssets.cashTotal;
    const taxable = y.portfolioAssets.taxableTotal;
    const retirement = y.portfolioAssets.retirementTotal;
    return { year: y.year, cash, taxable, retirement, total: cash + taxable + retirement };
  });
}

// ── Assets at retirement: by type ────────────────────────────────────────────
export interface AssetsByType { cash: number; taxable: number; retirement: number; total: number; }

export function assetsByType(years: ProjectionYear[], retirementYear: number): AssetsByType {
  const py = retirementYearRow(years, retirementYear);
  const cash = py?.portfolioAssets.cashTotal ?? 0;
  const taxable = py?.portfolioAssets.taxableTotal ?? 0;
  const retirement = py?.portfolioAssets.retirementTotal ?? 0;
  return { cash, taxable, retirement, total: cash + taxable + retirement };
}

// ── Assets at retirement: by tax type ────────────────────────────────────────
// Mirrors tax-summary/aggregate.ts:computeRetirementComposition. Roth includes
// full roth_ira balances + the designated-Roth slice inside 401k/403b.
export interface AssetsByTaxType { roth: number; preTax: number; taxable: number; total: number; }

export function assetsByTaxType(
  years: ProjectionYear[],
  clientData: ClientData,
  retirementYear: number,
): AssetsByTaxType {
  const py = retirementYearRow(years, retirementYear);
  let roth = 0, preTax = 0, taxable = 0;
  if (py) {
    for (const a of clientData.accounts) {
      const led = py.accountLedgers[a.id];
      const ev = led?.endingValue ?? 0;
      if (a.category === "retirement") {
        const rothPortion =
          a.subType === "roth_ira" ? ev
          : a.subType === "401k" || a.subType === "403b" ? (led?.rothValueEoY ?? 0)
          : 0;
        roth += rothPortion;
        preTax += ev - rothPortion;
      } else if (a.category === "taxable") {
        taxable += ev;
      }
    }
  }
  return { roth, preTax, taxable, total: roth + preTax + taxable };
}

// ── Living expenses: today vs retirement year ────────────────────────────────
export interface LivingExpenseCompare { today: number; retirement: number; }

export function livingExpensesTodayVsRetirement(
  years: ProjectionYear[],
  clientData: ClientData,
  retirementYear: number,
): LivingExpenseCompare {
  const today = clientData.expenses
    .filter((e) => e.type === "living")
    .reduce((s, e) => s + e.annualAmount, 0);
  const py = retirementYearRow(years, retirementYear);
  const retirement = py?.expenses.living ?? 0;
  return { today, retirement };
}

// ── Other expenses active at retirement (insurance, property tax, debt, other) ─
export interface OtherRetirementExpenses { insurance: number; realEstate: number; liabilities: number; other: number; }

export function otherRetirementExpenses(years: ProjectionYear[], retirementYear: number): OtherRetirementExpenses {
  const py = retirementYearRow(years, retirementYear);
  return {
    insurance: py?.expenses.insurance ?? 0,
    realEstate: py?.expenses.realEstate ?? 0,
    liabilities: py?.expenses.liabilities ?? 0,
    other: py?.expenses.other ?? 0,
  };
}

// ── Income continuing in retirement ──────────────────────────────────────────
export interface RetirementIncomeRow { id: string; label: string; type: string; amount: number; }

/** Income streams whose dollar amount is non-zero in the retirement year (per
 *  income.bySource), excluding Social Security (shown in its own panel). */
export function incomeInRetirement(
  years: ProjectionYear[],
  clientData: ClientData,
  retirementYear: number,
): RetirementIncomeRow[] {
  const py = retirementYearRow(years, retirementYear);
  if (!py) return [];
  const bySource = py.income.bySource;
  const rows: RetirementIncomeRow[] = [];
  for (const inc of clientData.incomes) {
    if (inc.type === "social_security") continue;
    const amount = bySource[inc.id] ?? 0;
    if (amount > 0) rows.push({ id: inc.id, label: inc.name, type: inc.type, amount });
  }
  return rows.sort((a, b) => b.amount - a.amount);
}

// ── Asset transactions during retirement ─────────────────────────────────────
export interface AssetTxnRow { year: number; name: string; kind: "sale" | "purchase"; amount: number; }

export function assetTransactionsInRetirement(years: ProjectionYear[], retirementYear: number): AssetTxnRow[] {
  const rows: AssetTxnRow[] = [];
  for (const y of years) {
    if (y.year < retirementYear) continue;
    const tb = y.techniqueBreakdown;
    if (!tb) continue;
    for (const s of tb.sales) rows.push({ year: y.year, name: s.name, kind: "sale", amount: s.netProceeds });
    for (const p of tb.purchases) rows.push({ year: y.year, name: p.name, kind: "purchase", amount: p.purchasePrice });
  }
  return rows;
}
