// Pure merge-token registry + renderer for advisor-authored plan-text
// (observations, next-steps, etc). Resolves `{{token}}` placeholders in
// markdown against live plan data. Framework-free — consumed by both API
// routes and the PDF pipeline, so no Next/DB imports here.
import type { ClientData, ClientInfo } from "@/engine/types";
import type { ProjectionResult } from "@/engine/projection";
import { liquidPortfolioBoy, portfolioTotalBoy } from "@/engine/portfolio-snapshot";
import { exactCurrency } from "@/lib/presentations/format";
import { householdSavingsRate } from "@/lib/presentations/savings-rate";

export interface TokenContext {
  clientData: ClientData;
  projection: ProjectionResult;
  /** Structural — accepts `MonteCarloSummary` (or any object with a
   *  `successRate`) without this module importing the monteCarlo engine. */
  monteCarlo?: { successRate: number } | null;
}

export interface PlanToken {
  id: string;
  label: string;
  category: "People" | "Plan" | "Balance Sheet" | "Cash Flow" | "Analysis";
  resolve: (ctx: TokenContext) => string | null;
}

function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

function sumValues(record: Record<string, number>): number {
  return Object.values(record).reduce((sum, v) => sum + v, 0);
}

function retirementAgeFor(client: ClientInfo): number {
  return client.retirementAge;
}

/**
 * Wraps a resolver so a thrown error (missing/malformed fixture data) yields
 * null instead of crashing the caller. Every token's `resolve` goes through
 * this.
 */
function safe(fn: (ctx: TokenContext) => string | null): PlanToken["resolve"] {
  return (ctx: TokenContext) => {
    try {
      return fn(ctx);
    } catch {
      return null;
    }
  };
}

/** `exactCurrency` prints a hyphen-minus; a client-facing sentence gets the
 *  real minus sign, matching the deck's other signed figures. */
function signedCurrency(n: number): string {
  return exactCurrency(n).replace(/^-/, "−");
}

/** "a, b and c" — no Oxford comma, matching the spec's example sentence. */
function joinWithAnd(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

export const PLAN_TOKENS: PlanToken[] = [
  {
    id: "client_first_name",
    label: "Client first name",
    category: "People",
    resolve: safe(({ clientData }) => clientData.client.firstName ?? null),
  },
  {
    id: "spouse_first_name",
    label: "Spouse first name",
    category: "People",
    resolve: safe(({ clientData }) => clientData.client.spouseName ?? null),
  },
  {
    id: "household_names",
    label: "Household names",
    category: "People",
    resolve: safe(({ clientData }) => {
      const { firstName, spouseName } = clientData.client;
      return spouseName ? `${firstName} & ${spouseName}` : firstName;
    }),
  },
  {
    id: "client_retirement_age",
    label: "Client retirement age",
    category: "People",
    resolve: safe(({ clientData }) =>
      String(retirementAgeFor(clientData.client)),
    ),
  },
  {
    id: "spouse_retirement_age",
    label: "Spouse retirement age",
    category: "People",
    resolve: safe(({ clientData }) => {
      const age = clientData.client.spouseRetirementAge;
      return age == null ? null : String(age);
    }),
  },
  {
    id: "retirement_year",
    label: "Retirement year",
    category: "Plan",
    resolve: safe(({ clientData, projection }) => {
      const firstYear = projection.years[0];
      const retirementAge = retirementAgeFor(clientData.client);
      return String(firstYear.year + (retirementAge - firstYear.ages.client));
    }),
  },
  {
    id: "years_to_retirement",
    label: "Years to retirement",
    category: "Plan",
    // Spelled with its unit so no library body has to pluralise. Null once
    // retired: "0 years from now" is not something a client should read.
    resolve: safe(({ clientData, projection }) => {
      const n = retirementAgeFor(clientData.client) - projection.years[0].ages.client;
      if (n <= 0) return null;
      return n === 1 ? "1 year" : `${n} years`;
    }),
  },
  {
    id: "plan_end_year",
    label: "Plan end year",
    category: "Plan",
    resolve: safe(({ projection }) => {
      const lastYear = projection.years.at(-1);
      return lastYear ? String(lastYear.year) : null;
    }),
  },
  {
    id: "net_worth",
    label: "Net worth (today)",
    category: "Balance Sheet",
    // "Today" means the START of plan year 1 — the advisor-entered balances,
    // before the first year of growth, savings and withdrawals runs. A
    // projection year's `portfolioAssets` is an END-of-year snapshot, so
    // reading it here handed the client a net worth they do not have yet AND
    // paired it with `liabilityBalancesBoY`, which is beginning-of-year: the
    // two sides of the subtraction were a year apart.
    resolve: safe(({ projection }) => {
      const firstYear = projection.years[0];
      const liabilities = sumValues(firstYear.liabilityBalancesBoY);
      return exactCurrency(
        portfolioTotalBoy(firstYear, projection.years) - liabilities,
      );
    }),
  },
  {
    id: "total_liabilities",
    label: "Total liabilities (today)",
    category: "Balance Sheet",
    // Already beginning-of-year, and the one balance-sheet token that always
    // was — it is the yardstick the other two now match.
    resolve: safe(({ projection }) => {
      const firstYear = projection.years[0];
      return exactCurrency(sumValues(firstYear.liabilityBalancesBoY));
    }),
  },
  {
    id: "portfolio_assets",
    label: "Portfolio assets (today)",
    category: "Balance Sheet",
    // Beginning-of-year-1 `liquidTotal` — the same figure the cash-flow
    // report's "Portfolio (BoY)" column shows, not the end-of-year balance in
    // the row beside it.
    resolve: safe(({ projection }) =>
      exactCurrency(liquidPortfolioBoy(projection.years[0], projection.years)),
    ),
  },
  {
    id: "largest_liability",
    label: "Largest liability (today)",
    category: "Balance Sheet",
    // Beginning-of-year balances, the same figures {{total_liabilities}} sums.
    resolve: safe(({ clientData, projection }) => {
      const boy = projection.years[0].liabilityBalancesBoY;
      const ranked = clientData.liabilities
        .map((l) => ({ l, balance: boy[l.id] ?? 0 }))
        .filter((x) => x.balance > 0)
        .sort((a, b) => b.balance - a.balance);
      const top = ranked[0];
      if (!top) return null;
      const rate = `${Number((top.l.interestRate * 100).toFixed(2))}%`;
      return `${top.l.name} (${exactCurrency(top.balance)} at ${rate})`;
    }),
  },
  // Cash-flow tokens are FLOWS: a full year of money moving, not a balance at
  // a moment. They read "(this year)" rather than "(today)" because there is
  // no point-in-time equivalent to fall back to the way the Balance Sheet
  // tokens do.
  {
    id: "annual_income",
    label: "Annual income (this year)",
    category: "Cash Flow",
    resolve: safe(({ projection }) =>
      exactCurrency(projection.years[0].totalIncome),
    ),
  },
  {
    id: "annual_spending",
    label: "Annual spending (this year)",
    category: "Cash Flow",
    resolve: safe(({ projection }) =>
      exactCurrency(projection.years[0].expenses.total),
    ),
  },
  {
    id: "annual_savings",
    label: "Annual savings (this year)",
    category: "Cash Flow",
    resolve: safe(({ projection }) =>
      exactCurrency(projection.years[0].savings.total),
    ),
  },
  {
    id: "savings_by_account",
    label: "Savings by account (this year)",
    category: "Cash Flow",
    resolve: safe(({ clientData, projection }) => {
      const byAccount = projection.years[0].savings.byAccount;
      const nameById = new Map(clientData.accounts.map((a) => [a.id, a.name]));
      const parts = Object.entries(byAccount)
        .filter(([, amount]) => amount > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([id, amount]) => `${exactCurrency(amount)} to ${nameById.get(id) ?? "an account"}`);
      return parts.length > 0 ? joinWithAnd(parts) : null;
    }),
  },
  {
    id: "savings_rate",
    label: "Savings rate (this year)",
    category: "Cash Flow",
    // The one definition every sheet prints (`savings-rate.ts`). Null rather
    // than 0% when there is no salary: a rate has no denominator there.
    resolve: safe(({ projection }) => {
      const year = projection.years[0];
      if (year.income.salaries <= 0) return null;
      return pct(householdSavingsRate(year));
    }),
  },
  {
    id: "employer_contributions",
    label: "Employer contributions (this year)",
    category: "Cash Flow",
    resolve: safe(({ projection }) => exactCurrency(projection.years[0].savings.employerTotal)),
  },
  {
    id: "annual_surplus",
    label: "Annual surplus after savings and taxes (this year)",
    category: "Cash Flow",
    // `netCashFlow` = totalIncome − totalExpenses (projection.ts); negative is
    // a real answer, printed as one.
    resolve: safe(({ projection }) => signedCurrency(projection.years[0].netCashFlow)),
  },
  {
    id: "effective_tax_rate",
    label: "Effective tax rate (this year)",
    category: "Cash Flow",
    resolve: safe(({ projection }) => {
      const year = projection.years[0];
      if (year.totalIncome <= 0) return null;
      return pct(year.expenses.taxes / year.totalIncome);
    }),
  },
  {
    id: "mc_success",
    label: "Plan confidence",
    category: "Analysis",
    resolve: safe(({ monteCarlo }) =>
      monteCarlo ? pct(monteCarlo.successRate) : null,
    ),
  },
  {
    id: "estate_tax_at_horizon",
    label: "Estate tax at plan horizon",
    category: "Analysis",
    resolve: safe(({ projection }) => {
      const lastYear = projection.years.at(-1);
      if (!lastYear) return null;
      return exactCurrency(
        lastYear.hypotheticalEstateTax.primaryFirst.totals.total,
      );
    }),
  },
  {
    id: "ending_portfolio",
    label: "Ending portfolio value",
    category: "Analysis",
    resolve: safe(({ projection }) => {
      const lastYear = projection.years.at(-1);
      return lastYear
        ? exactCurrency(lastYear.portfolioAssets.liquidTotal)
        : null;
    }),
  },
];

export function listTokens(): Array<Pick<PlanToken, "id" | "label" | "category">> {
  return PLAN_TOKENS.map(({ id, label, category }) => ({ id, label, category }));
}

export function resolveAllTokens(ctx: TokenContext): Record<string, string | null> {
  const values: Record<string, string | null> = {};
  for (const token of PLAN_TOKENS) {
    values[token.id] = token.resolve(ctx);
  }
  return values;
}

const TOKEN_PATTERN = /\{\{([a-z0-9_]+)\}\}/g;

export function renderTokens(
  markdown: string,
  values: Record<string, string | null>,
): string {
  return markdown.replace(TOKEN_PATTERN, (_, id: string) => values[id] ?? "—");
}
