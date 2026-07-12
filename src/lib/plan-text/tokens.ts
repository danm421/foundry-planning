// Pure merge-token registry + renderer for advisor-authored plan-text
// (observations, next-steps, etc). Resolves `{{token}}` placeholders in
// markdown against live plan data. Framework-free — consumed by both API
// routes and the PDF pipeline, so no Next/DB imports here.
import type { ClientData, ClientInfo } from "@/engine/types";
import type { ProjectionResult } from "@/engine/projection";
import { exactCurrency } from "@/lib/presentations/format";

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
    resolve: safe(({ projection }) => {
      const firstYear = projection.years[0];
      const liabilities = sumValues(firstYear.liabilityBalancesBoY);
      return exactCurrency(firstYear.portfolioAssets.total - liabilities);
    }),
  },
  {
    id: "total_liabilities",
    label: "Total liabilities (today)",
    category: "Balance Sheet",
    resolve: safe(({ projection }) => {
      const firstYear = projection.years[0];
      return exactCurrency(sumValues(firstYear.liabilityBalancesBoY));
    }),
  },
  {
    id: "portfolio_assets",
    label: "Portfolio assets (today)",
    category: "Balance Sheet",
    resolve: safe(({ projection }) =>
      exactCurrency(projection.years[0].portfolioAssets.liquidTotal),
    ),
  },
  {
    id: "annual_income",
    label: "Annual income (today)",
    category: "Cash Flow",
    resolve: safe(({ projection }) =>
      exactCurrency(projection.years[0].totalIncome),
    ),
  },
  {
    id: "annual_spending",
    label: "Annual spending (today)",
    category: "Cash Flow",
    resolve: safe(({ projection }) =>
      exactCurrency(projection.years[0].expenses.total),
    ),
  },
  {
    id: "annual_savings",
    label: "Annual savings (today)",
    category: "Cash Flow",
    resolve: safe(({ projection }) =>
      exactCurrency(projection.years[0].savings.total),
    ),
  },
  {
    id: "mc_success",
    label: "Monte Carlo success rate",
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
