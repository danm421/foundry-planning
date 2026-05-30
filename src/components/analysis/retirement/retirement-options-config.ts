// Configuration for the "What are your Options?" solver grid + live Explore
// column on the Retirement Analysis Summary view.
//
// Declares:
//   - the editable Explore ROWS (label + current-value accessor + input kind),
//   - the 3 precomputed solved COLUMNS + which Explore row each highlights,
//   - a pure mapper from an Explore row edit to a SolverMutation, REUSING the
//     solver's existing mutation kinds (no new kinds invented), and
//   - defaultSavingsAccountId() for the min-savings column target.
//
// Framework-free (no JSX, no React) so it can be unit-tested directly.

import type { ClientData } from "@/engine/types";
import type { SolverMutation } from "@/lib/solver/types";
import { formatCurrency } from "@/components/monte-carlo/lib/format";

// ---------------------------------------------------------------------------
// Explore rows
// ---------------------------------------------------------------------------

/** Stable identifiers for each Explore row. */
export type ExploreRowKey =
  | "pre-tax-contributions"
  | "taxable-contributions"
  | "roth-contributions"
  | "retirement-expenses"
  | "retirement-age-client"
  | "retirement-age-spouse"
  | "social-security-client"
  | "social-security-spouse"
  | "other-retirement-income"
  | "other-retirement-income-end-year";

/** How the row's input renders. "currency" / "year" / "age" are all numeric
 *  inputs, distinguished for formatting + min/max + the Current sublabel. */
export type ExploreInputKind = "currency" | "year" | "age";

export interface ExploreRow {
  key: ExploreRowKey;
  label: string;
  inputKind: ExploreInputKind;
  /** Current effective value of the lever this row edits (raw — annual dollars,
   *  a year, or an age). null when the underlying entity doesn't exist. */
  currentValue: number | null;
  /** Sub-identifier the mapper needs to build the mutation: the accountId,
   *  expenseId, incomeId, or person this row targets. */
  targetId: string;
  /** Person for age/SS rows. Undefined for non-person rows. */
  person?: "client" | "spouse";
}

// ---------------------------------------------------------------------------
// Account / rule selection helpers
// ---------------------------------------------------------------------------

/** Active dollar-mode savings rules (skip IRS-max and percent-of-salary rules:
 *  those can't be expressed as a single editable annual-dollar input). */
function dollarSavingsRules(tree: ClientData): {
  rule: ClientData["savingsRules"][number];
  account: ClientData["accounts"][number];
}[] {
  const out: {
    rule: ClientData["savingsRules"][number];
    account: ClientData["accounts"][number];
  }[] = [];
  for (const rule of tree.savingsRules) {
    if (rule.contributeMax) continue;
    if (rule.annualPercent != null && rule.annualPercent > 0) continue;
    const account = tree.accounts.find((a) => a.id === rule.accountId);
    if (!account) continue;
    out.push({ rule, account });
  }
  return out;
}

type SavingsBucket = "pre-tax" | "taxable" | "roth";

function bucketFor(
  rule: ClientData["savingsRules"][number],
  account: ClientData["accounts"][number],
): SavingsBucket | null {
  const roth = rule.rothPercent ?? 0;
  if (account.category === "retirement") {
    return roth > 0 ? "roth" : "pre-tax";
  }
  if (account.category === "taxable") return "taxable";
  return null;
}

/** Largest (by annualAmount) dollar-mode savings rule in a bucket. */
function largestRuleInBucket(tree: ClientData, bucket: SavingsBucket) {
  let best: { ruleId: string; accountId: string; amount: number } | null = null;
  for (const { rule, account } of dollarSavingsRules(tree)) {
    if (bucketFor(rule, account) !== bucket) continue;
    if (best === null || rule.annualAmount > best.amount) {
      best = { ruleId: rule.id, accountId: rule.accountId, amount: rule.annualAmount };
    }
  }
  return best;
}

/** The single living-expense row that begins after the current year — i.e. the
 *  retirement-phase living expense the advisor edits in the Cost of Retirement
 *  step. Falls back to the largest living expense when none is future-dated. */
function retirementLivingExpense(tree: ClientData) {
  const currentYear = new Date().getFullYear();
  const living = tree.expenses.filter((e) => e.type === "living");
  if (living.length === 0) return null;
  const future = living.filter((e) => e.startYear > currentYear);
  const pool = future.length > 0 ? future : living;
  return pool.reduce((a, b) => (b.annualAmount > a.annualAmount ? b : a));
}

function ssFor(tree: ClientData, person: "client" | "spouse") {
  return tree.incomes.find(
    (i) => i.type === "social_security" && i.owner === person,
  );
}

/** Non-SS, non-salary retirement income the advisor entered in the Retirement
 *  Income step. Picks the largest "other"/"deferred"/"trust" income. */
function otherRetirementIncome(tree: ClientData) {
  const candidates = tree.incomes.filter(
    (i) => i.type === "other" || i.type === "deferred" || i.type === "trust",
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((a, b) => (b.annualAmount > a.annualAmount ? b : a));
}

/** The largest pre-tax (retirement-category) account id. Used as the
 *  min-savings solve target and the `savingsAccountId` body field. Falls back
 *  to the largest account of any category, then to "" when the tree is empty. */
export function defaultSavingsAccountId(tree: ClientData): string {
  const retirement = tree.accounts.filter((a) => a.category === "retirement");
  const pool = retirement.length > 0 ? retirement : tree.accounts;
  if (pool.length === 0) return "";
  return pool.reduce((a, b) => (b.value > a.value ? b : a)).id;
}

// ---------------------------------------------------------------------------
// Row builder
// ---------------------------------------------------------------------------

/**
 * Builds the editable Explore rows for a given tree. Rows whose underlying
 * entity is absent (e.g. no spouse, no Roth contributions) are OMITTED so the
 * grid never renders an input that maps to nothing.
 */
export function buildExploreRows(tree: ClientData): ExploreRow[] {
  const rows: ExploreRow[] = [];

  const preTax = largestRuleInBucket(tree, "pre-tax");
  if (preTax) {
    rows.push({
      key: "pre-tax-contributions",
      label: "Pre-Tax Contributions",
      inputKind: "currency",
      currentValue: preTax.amount,
      targetId: preTax.accountId,
    });
  }

  const taxable = largestRuleInBucket(tree, "taxable");
  if (taxable) {
    rows.push({
      key: "taxable-contributions",
      label: "Taxable Contributions",
      inputKind: "currency",
      currentValue: taxable.amount,
      targetId: taxable.accountId,
    });
  }

  const roth = largestRuleInBucket(tree, "roth");
  if (roth) {
    rows.push({
      key: "roth-contributions",
      label: "Roth Contributions",
      inputKind: "currency",
      currentValue: roth.amount,
      targetId: roth.accountId,
    });
  }

  const expense = retirementLivingExpense(tree);
  if (expense) {
    rows.push({
      key: "retirement-expenses",
      label: "Retirement Expenses",
      inputKind: "currency",
      currentValue: expense.annualAmount,
      targetId: expense.id,
    });
  }

  rows.push({
    key: "retirement-age-client",
    label: `${tree.client.firstName}'s Retirement Age`,
    inputKind: "age",
    currentValue: tree.client.retirementAge,
    targetId: "client",
    person: "client",
  });
  if (tree.client.spouseRetirementAge != null) {
    rows.push({
      key: "retirement-age-spouse",
      label: `${tree.client.spouseName ?? "Spouse"}'s Retirement Age`,
      inputKind: "age",
      currentValue: tree.client.spouseRetirementAge,
      targetId: "spouse",
      person: "spouse",
    });
  }

  const clientSs = ssFor(tree, "client");
  if (clientSs) {
    rows.push({
      key: "social-security-client",
      label: `${tree.client.firstName}'s Social Security`,
      inputKind: "currency",
      currentValue: clientSs.annualAmount,
      targetId: "client",
      person: "client",
    });
  }
  const spouseSs = ssFor(tree, "spouse");
  if (spouseSs) {
    rows.push({
      key: "social-security-spouse",
      label: `${tree.client.spouseName ?? "Spouse"}'s Social Security`,
      inputKind: "currency",
      currentValue: spouseSs.annualAmount,
      targetId: "spouse",
      person: "spouse",
    });
  }

  const other = otherRetirementIncome(tree);
  if (other) {
    rows.push({
      key: "other-retirement-income",
      label: other.name || "Other Retirement Income",
      inputKind: "currency",
      currentValue: other.annualAmount,
      targetId: other.id,
    });
    rows.push({
      key: "other-retirement-income-end-year",
      label: `${other.name || "Other Retirement Income"} End Year`,
      inputKind: "year",
      currentValue: other.endYear,
      targetId: other.id,
    });
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Explore row → SolverMutation
// ---------------------------------------------------------------------------

/**
 * Maps an Explore row edit to a SolverMutation, reusing the solver's existing
 * mutation kinds. Returns null when the row can't be mapped (caller treats it
 * as read-only) — this never happens for rows produced by buildExploreRows,
 * which only emits mappable rows.
 */
export function exploreRowToMutation(
  row: ExploreRow,
  value: number,
): SolverMutation | null {
  switch (row.key) {
    case "pre-tax-contributions":
    case "taxable-contributions":
    case "roth-contributions":
      return {
        kind: "savings-contribution",
        accountId: row.targetId,
        annualAmount: value,
      };
    case "retirement-expenses":
      return {
        kind: "expense-annual-amount",
        expenseId: row.targetId,
        annualAmount: value,
      };
    case "retirement-age-client":
    case "retirement-age-spouse":
      return {
        kind: "retirement-age",
        person: row.person ?? "client",
        age: value,
      };
    case "social-security-client":
    case "social-security-spouse":
      return {
        kind: "ss-annual-amount",
        person: row.person ?? "client",
        amount: value,
      };
    case "other-retirement-income":
      return {
        kind: "income-annual-amount",
        incomeId: row.targetId,
        annualAmount: value,
      };
    case "other-retirement-income-end-year":
      return {
        kind: "income-end-year",
        incomeId: row.targetId,
        year: value,
      };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Solved columns
// ---------------------------------------------------------------------------

/** The three deterministic full-funding columns, matching the `column` ids the
 *  /options SSE emits ("min-savings" | "max-spending" | "earliest-retirement"). */
export type SolvedColumnId =
  | "min-savings"
  | "max-spending"
  | "earliest-retirement";

export interface SolvedColumnConfig {
  id: SolvedColumnId;
  title: string;
  /** The Explore row this column's solved lever maps onto — rendered green.
   *  When this row is absent from the built rows, the column is "Not
   *  applicable" (its solved lever can't be expressed for this client). */
  highlightRow: ExploreRowKey;
  /**
   * Turns the raw `solvedValue` the SSE returns into the display string for the
   * highlighted cell. `rows` is the same source of truth the grid renders, so
   * formatting (and any base value, e.g. the retirement-expense the multiplier
   * scales) comes from one place. Returns null when it can't be formatted.
   */
  formatSolved: (solvedValue: number, rows: ExploreRow[]) => string | null;
}

/** Format a solved value the same way the named Explore row formats its own
 *  current value, so the solved cell and the row's "Current:" sublabel match. */
function formatLikeRow(
  rows: ExploreRow[],
  key: ExploreRowKey,
  value: number,
): string {
  const row = rows.find((r) => r.key === key);
  if (row?.inputKind === "currency") return formatCurrency(value);
  return String(Math.round(value));
}

export const SOLVED_COLUMNS: SolvedColumnConfig[] = [
  {
    id: "min-savings",
    title: "Minimum Additional Savings",
    highlightRow: "pre-tax-contributions",
    // Solved lever is the annual contribution dollars — already in the row's
    // unit (currency), so format it like the contributions row.
    formatSolved: (v, rows) => formatLikeRow(rows, "pre-tax-contributions", v),
  },
  {
    id: "max-spending",
    title: "Maximum Retirement Spending",
    highlightRow: "retirement-expenses",
    // Solved lever is a MULTIPLIER in [0.5, 1.5] (living-expense-scale), not a
    // dollar figure. The displayed value is the resulting spend:
    // currentRetirementExpense * multiplier, formatted like the expense row.
    formatSolved: (multiplier, rows) => {
      const base = rows.find((r) => r.key === "retirement-expenses")
        ?.currentValue;
      if (base == null) return null;
      return formatLikeRow(rows, "retirement-expenses", base * multiplier);
    },
  },
  {
    id: "earliest-retirement",
    title: "Earliest Retirement Age",
    highlightRow: "retirement-age-client",
    // Solved lever is an age — render as an integer like the age row.
    formatSolved: (v, rows) =>
      formatLikeRow(rows, "retirement-age-client", v),
  },
];

/**
 * The account id the "Minimum Additional Savings" column acts on — the SAME
 * account the highlighted Pre-Tax Contributions row targets, so the solved
 * account and the highlighted row never diverge. Returns null when no editable
 * pre-tax contribution row exists (the column is then "Not applicable").
 */
export function savingsColumnAccountId(rows: ExploreRow[]): string | null {
  const minSavings = SOLVED_COLUMNS.find((c) => c.id === "min-savings");
  if (!minSavings) return null;
  const row = rows.find((r) => r.key === minSavings.highlightRow);
  return row ? row.targetId : null;
}
