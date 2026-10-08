// Liability amortization sheets: the liability dialog's Amortization tab — a
// balance/interest/payments chart and the year-by-year schedule — once per
// chosen loan. The schedule comes from the same helper the tab draws, so the
// deck and the dialog cannot disagree.

import type { ClientData, Liability } from "@/engine/types";
// A zero-import leaf: nothing of the projection follows it into the browser
// bundle the registry reaches this module from.
import { isHeldFlatLiability, type LiabilityType } from "@/engine/liability-kind";
import {
  amortizationTotals,
  liabilityAmortizationSchedule,
  type AmortizationScheduleRow,
} from "@/lib/loan-math";
import { dataLight } from "@/brand";
import { buildDrillChartSpec } from "@/lib/presentations/shared/build-chart-spec";
import { exactCurrency } from "@/lib/presentations/format";
import type {
  AmortizationTableRow,
  LiabilityAmortizationPageData,
  LiabilityAmortizationPageOptions,
  LoanAmortizationSection,
} from "./types";

export const PAGE_TITLE = "Loan Amortization";

/** Table rows that fit under the heading, key terms and chart on a loan's
 *  first sheet, and under the heading alone on each sheet after it. Measured
 *  against the rendered PDF in `page-geometry.test.tsx`, which fails if a row
 *  ever lands on a sheet the count did not plan for. */
export const FIRST_SHEET_ROWS = 22;
export const NEXT_SHEET_ROWS = 38;
/** Row slots the totals row and the footnote take on a loan's last sheet. */
const TOTALS_ROWS = 1;
const FOOTNOTE_ROWS = 2;

/** A loan with a schedule to draw: amortizing, with a balance and a payment.
 *  Held-flat debt (a credit card, or a loan with no term) has no schedule. The
 *  launcher's loan picker offers exactly the loans this accepts. */
export function hasAmortizationSchedule(l: {
  balance: number;
  monthlyPayment: number;
  liabilityType?: LiabilityType | null;
  termMonths?: number | null;
}): boolean {
  return !isHeldFlatLiability(l) && l.balance > 0 && l.monthlyPayment > 0;
}

/** Largest balance first — the order the launcher's picker lists them in, too. */
export const byBalanceDesc = (a: { balance: number }, b: { balance: number }) => b.balance - a.balance;

/** The loans this page prints. A picked loan the plan no longer has (deleted,
 *  or removed in this scenario) is skipped. */
export function selectedLoans(
  clientData: ClientData,
  options: LiabilityAmortizationPageOptions,
): Liability[] {
  const loans = (clientData.liabilities ?? []).filter(hasAmortizationSchedule).sort(byBalanceDesc);
  const ids = options.liabilityIds;
  return ids == null ? loans : loans.filter((l) => ids.includes(l.id));
}

/**
 * Split the schedule into sheets. The rows that remain must leave room for the
 * totals row (and the footnote, when there is one) on the sheet they end on;
 * when they do not, at least one row carries over so the totals never print
 * alone.
 */
export function paginateRows<T>(rows: T[], tailRows: number): T[][] {
  const sheets: T[][] = [];
  let rest = rows;
  let capacity = FIRST_SHEET_ROWS;
  while (rest.length + tailRows > capacity) {
    const take = Math.min(capacity, rest.length - 1);
    sheets.push(rest.slice(0, take));
    rest = rest.slice(take);
    capacity = NEXT_SHEET_ROWS;
  }
  sheets.push(rest);
  return sheets;
}

const rateLabel = (rate: number) => `${Number((rate * 100).toFixed(3))}%`;

function buildSection(
  loan: Liability,
  schedule: AmortizationScheduleRow[],
  currentYear: number,
): LoanAmortizationSection {
  const totals = amortizationTotals(schedule);
  const last = schedule[schedule.length - 1];
  const forgiven = last.forgivenAmount > 0 ? last : null;

  let paid = 0;
  let interest = 0;
  const cumulativePaid: number[] = [];
  const cumulativeInterest: number[] = [];
  for (const row of schedule) {
    paid += row.payment + row.extraPayment;
    interest += row.interest;
    cumulativePaid.push(paid);
    cumulativeInterest.push(interest);
  }

  const chartSpec = buildDrillChartSpec({
    years: schedule.map((r) => r.year),
    stacks: [],
    lines: [
      { seriesId: "balance", label: "Balance", color: dataLight.blue, strokeWidth: 2, values: schedule.map((r) => r.endingBalance) },
      { seriesId: "interest", label: "Cumulative interest", color: dataLight.green, values: cumulativeInterest },
      { seriesId: "paid", label: "Cumulative payments", color: dataLight.red, values: cumulativePaid },
    ],
    markers: [],
    frame: { width: 526, height: 200, margin: { top: 12, right: 12, bottom: 46, left: 56 } },
  });

  const rows: AmortizationTableRow[] = schedule.map(
    ({ year, payment, interest, principal, extraPayment, endingBalance }) => ({
      year,
      payment,
      interest,
      principal,
      extraPayment,
      endingBalance,
      isCurrentYear: year === currentYear,
    }),
  );

  const footnote = forgiven
    ? `${exactCurrency(forgiven.forgivenAmount)} forgiven in ${forgiven.year} — the balance left at the end of the term is written off, not paid.`
    : null;

  return {
    liabilityId: loan.id,
    name: loan.name,
    facts: [
      { label: "Balance", value: exactCurrency(loan.balance) },
      { label: "Interest rate", value: rateLabel(loan.interestRate) },
      { label: "Monthly payment", value: exactCurrency(loan.monthlyPayment) },
      { label: forgiven ? "Forgiven" : "Paid off", value: String(last.year) },
    ],
    chartSpec,
    sheets: paginateRows(rows, TOTALS_ROWS + (footnote ? FOOTNOTE_ROWS : 0)),
    totals,
    footnote,
  };
}

export function buildLiabilityAmortizationData(
  clientData: ClientData,
  options: LiabilityAmortizationPageOptions,
  scenarioLabel: string,
  today: Date = new Date(),
): LiabilityAmortizationPageData {
  const loans: LoanAmortizationSection[] = [];
  for (const loan of selectedLoans(clientData, options)) {
    const schedule = liabilityAmortizationSchedule(loan, loan.extraPayments, today);
    if (schedule.length > 0) loans.push(buildSection(loan, schedule, today.getFullYear()));
  }
  return { subtitle: scenarioLabel, loans };
}

export const loanTitle = (loan: Pick<LoanAmortizationSection, "name">) => `Amortization — ${loan.name}`;

/** Every sheet the page prints: each loan's schedule sheets, or one sheet for
 *  the empty state. */
export function estimateLiabilityAmortizationPageCount(data: LiabilityAmortizationPageData): number {
  return Math.max(1, data.loans.reduce((n, loan) => n + loan.sheets.length, 0));
}

/** One Contents entry per loan, at the sheet its schedule starts on. */
export function liabilityAmortizationTocSections(
  data: LiabilityAmortizationPageData,
): Array<{ title: string; offset: number }> {
  if (data.loans.length === 0) return [{ title: PAGE_TITLE, offset: 0 }];
  let offset = 0;
  return data.loans.map((loan) => {
    const entry = { title: loanTitle(loan), offset };
    offset += loan.sheets.length;
    return entry;
  });
}
