import { resolveAccountCategory } from "@/lib/imports/commit/account-category";
import { holdingMarketValue } from "./normalize-holdings";
import type { ExtractedAccount, ExtractedHolding, ExtractedLiability } from "./types";

/** Two dollar figures are "the same" within this fraction of the larger. */
const SAME_FIGURE_PCT = 0.01;

/**
 * A brokerage account's margin loan belongs to the ACCOUNT (spec 2026-10-13):
 * the app stores the securities' full value with `marginBalance` beside it, so
 * net = value − marginBalance. A statement prints it the other way round — its
 * headline is the NET account value — so the prompt asks for exactly that plus
 * the loan. Two steps turn the pair into the app's shape:
 *
 * 1. This one, once per document at extraction: the loan as a positive amount,
 *    only on a taxable account, its negative cash line out of the positions, and
 *    a loan the document listed as a debt ("Margin Loan") moved onto the
 *    document's one taxable account — or dropped as a duplicate of a loan an
 *    account already carries. `value` stays NET, as printed.
 * 2. `grossUpMarginLoans`, in the merge's per-document pipeline AFTER duplicate
 *    readings collapse: those match on the printed balance, so adding the loan
 *    any earlier would stop two readings of one account from matching.
 *
 * Pure.
 */
export function applyMarginLoans(extracted: {
  accounts: ExtractedAccount[];
  liabilities: ExtractedLiability[];
}): { accounts: ExtractedAccount[]; liabilities: ExtractedLiability[]; warnings: string[] } {
  const warnings: string[] = [];
  const accounts = extracted.accounts.map((account): ExtractedAccount => {
    const loan = loanAmount(account.marginBalance);
    if (loan === undefined) return withoutLoan(account);
    // `accounts_margin_taxable_only`: the commit could never write it.
    if (resolveAccountCategory(account) !== "taxable") {
      warnings.push(
        `"${account.name}" lists a margin loan, but only a taxable brokerage account can carry one — it was left off.`,
      );
      return withoutLoan(account);
    }
    return {
      ...account,
      marginBalance: loan,
      ...(account.holdings ? { holdings: account.holdings.filter((h) => !isLoanLine(h)) } : {}),
    };
  });
  const taxable = accounts.filter((a) => resolveAccountCategory(a) === "taxable");

  const liabilities: ExtractedLiability[] = [];
  for (const debt of extracted.liabilities) {
    const balance = loanAmount(debt.balance);
    if (balance === undefined || !/\bmargin\b/i.test(debt.name ?? "")) {
      liabilities.push(debt);
      continue;
    }
    if (taxable.some((a) => a.marginBalance !== undefined && sameFigure(a.marginBalance, balance))) continue;
    const target = taxable.length === 1 && taxable[0].marginBalance === undefined ? taxable[0] : undefined;
    if (!target) {
      warnings.push(
        `"${debt.name}" looks like a margin loan, but this document doesn't say which brokerage account it's on — it was kept as a separate debt. Enter it as that account's margin loan instead.`,
      );
      liabilities.push(debt);
      continue;
    }
    target.marginBalance = balance;
    if (typeof debt.interestRate === "number") target.marginInterestRate = debt.interestRate;
    // A document that lists the loan as a debt states the account at its full
    // value, as a balance sheet does — net it, so step 2 restores that value.
    if (typeof target.value === "number") target.value = cents(target.value - balance);
  }

  return { accounts, liabilities, warnings };
}

/**
 * Step 2: each margined row's NET value → the securities' value. Positions that
 * already add up to the stated value — and not to value + loan — say the model
 * reported the gross figure despite the prompt; adding the loan again would
 * overstate the account by exactly that loan. Returns new rows: the input is a
 * persisted extraction that every later merge reads again.
 */
export function grossUpMarginLoans(rows: ExtractedAccount[]): ExtractedAccount[] {
  return rows.map((row) => {
    const { value, marginBalance: loan } = row;
    if (loan === undefined || typeof value !== "number") return row;
    const gross = cents(value + loan);
    const held = (row.holdings ?? []).reduce((sum, h) => sum + holdingMarketValue(h), 0);
    if (held > 0 && sameFigure(held, value) && !sameFigure(held, gross)) return row;
    return { ...row, value: gross };
  });
}

function withoutLoan(account: ExtractedAccount): ExtractedAccount {
  const copy = { ...account };
  delete copy.marginBalance;
  delete copy.marginInterestRate;
  return copy;
}

/** The loan's own line in a position list: an untickered debit (a short sale has a ticker). */
function isLoanLine(h: ExtractedHolding): boolean {
  return !h.ticker && holdingMarketValue(h) < 0;
}

/** A loan as a positive dollar amount: the model may print the debit as negative. */
function loanAmount(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v !== 0 ? Math.abs(v) : undefined;
}

function sameFigure(a: number, b: number): boolean {
  return Math.abs(a - b) <= SAME_FIGURE_PCT * Math.max(Math.abs(a), Math.abs(b));
}

const cents = (n: number) => Math.round(n * 100) / 100;
