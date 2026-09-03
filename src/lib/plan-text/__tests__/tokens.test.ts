import { describe, it, expect } from "vitest";
import type { ClientData } from "@/engine/types";
import type { ProjectionResult } from "@/engine/projection";
import {
  resolveAllTokens,
  renderTokens,
  listTokens,
  PLAN_TOKENS,
  type TokenContext,
} from "../tokens";

// Minimal fake ClientData/ProjectionResult fixture. Cast through `unknown`
// because these engine types have many fields irrelevant to the merge-token
// resolvers under test — mirrors the fixture pattern used elsewhere in the
// repo (e.g. src/lib/solver/__tests__/net-to-heirs.test.ts).
const clientData = {
  client: {
    firstName: "Sam",
    lastName: "Client",
    dateOfBirth: "1971-01-01",
    retirementAge: 65,
    planEndAge: 95,
    spouseName: "Alex",
    filingStatus: "married_joint",
  },
  accounts: [
    { id: "k1", name: "Sam's 401(k)" },
    { id: "r1", name: "Roth IRA" },
  ],
  liabilities: [
    { id: "l1", name: "Mortgage", interestRate: 0.0625 },
    { id: "l2", name: "Car loan", interestRate: 0.049 },
  ],
} as unknown as ClientData;

// Year 1 is deliberately "grown": every EoY bucket sits above its ledger's
// beginningValue, so a resolver that reads the end-of-year snapshot instead of
// the beginning-of-year one produces a visibly different number.
const firstYear = {
  year: 2026,
  ages: { client: 55 },
  totalIncome: 150000,
  income: { salaries: 120000 },
  expenses: { total: 120000, taxes: 30000 },
  // byAccount deliberately lists the smaller account first — the token must
  // sort by amount, not by insertion order.
  savings: { total: 30000, byAccount: { r1: 6500, k1: 23500 }, employerTotal: 6000 },
  netCashFlow: -4200,
  portfolioAssets: {
    taxable: { a1: 1800000 },
    realEstate: { h1: 700000 },
    total: 2500000,
    liquidTotal: 1800000,
  },
  accountLedgers: {
    a1: { beginningValue: 1500000, endingValue: 1800000 },
    h1: { beginningValue: 650000, endingValue: 700000 },
  },
  liabilityBalancesBoY: { l1: 400000, l2: 12000 },
  hypotheticalEstateTax: {
    year: 2026,
    primaryFirst: { totals: { total: 0 } },
  },
};

const lastYear = {
  year: 2056,
  ages: { client: 85 },
  totalIncome: 80000,
  expenses: { total: 60000 },
  savings: { total: 0 },
  portfolioAssets: { total: 3200000, liquidTotal: 3000000 },
  accountLedgers: {},
  liabilityBalancesBoY: {},
  hypotheticalEstateTax: {
    year: 2056,
    primaryFirst: { totals: { total: 450000 } },
  },
};

const projection = {
  years: [firstYear, lastYear],
} as unknown as ProjectionResult;

const baseCtx: TokenContext = { clientData, projection };

/** baseCtx with year 1 patched — the projection is rebuilt so the token
 *  under test reads exactly the field the test changed. */
function withFirstYear(patch: Record<string, unknown>): TokenContext {
  return {
    clientData,
    projection: { years: [{ ...firstYear, ...patch }, lastYear] } as unknown as ProjectionResult,
  };
}

describe("resolveAllTokens", () => {
  it("resolves household_names as 'Sam & Alex'", () => {
    const values = resolveAllTokens(baseCtx);
    expect(values.household_names).toBe("Sam & Alex");
  });

  // The "(today)" balance-sheet tokens read the BEGINNING of plan year 1 —
  // the advisor-entered balances — not the end of it. Reading years[0]'s
  // portfolioAssets snapshot (which is end-of-year) credited the household
  // with a full year of growth and savings it does not have yet, and paired
  // those grown assets with beginning-of-year liabilities.
  it("resolves net_worth from beginning-of-year assets, not the end-of-year snapshot", () => {
    const values = resolveAllTokens(baseCtx);
    // (1,500,000 + 650,000) - 412,000 = 1,738,000
    expect(values.net_worth).toBe("$1,738,000");
  });

  it("resolves portfolio_assets from the beginning-of-year liquid total", () => {
    const values = resolveAllTokens(baseCtx);
    expect(values.portfolio_assets).toBe("$1,500,000");
  });

  it("resolves total_liabilities from the beginning-of-year liability balances", () => {
    const values = resolveAllTokens(baseCtx);
    expect(values.total_liabilities).toBe("$412,000");
  });

  it("keeps the cash-flow tokens on year-1 totals — a flow has no today value", () => {
    const values = resolveAllTokens(baseCtx);
    expect(values.annual_income).toBe("$150,000");
    expect(values.annual_spending).toBe("$120,000");
  });

  it("still reports the end-of-plan portfolio from the last year's snapshot", () => {
    const values = resolveAllTokens(baseCtx);
    expect(values.ending_portfolio).toBe("$3,000,000");
  });

  it("resolves annual_savings from years[0].savings.total", () => {
    const values = resolveAllTokens(baseCtx);
    expect(values.annual_savings).toBe("$30,000");
  });

  it("resolves mc_success to null when monteCarlo is absent (renders as '—')", () => {
    // resolveAllTokens returns `string | null` per-field — null for missing
    // data. The "—" placeholder substitution is renderTokens' job (see the
    // renderTokens spec below), so we assert null here and check the
    // rendered "—" output separately.
    const values = resolveAllTokens(baseCtx);
    expect(values.mc_success).toBeNull();
    expect(renderTokens("{{mc_success}}", values)).toBe("—");
  });

  it("resolves mc_success to a rounded whole percent when monteCarlo present", () => {
    const values = resolveAllTokens({
      ...baseCtx,
      monteCarlo: { successRate: 0.874 },
    });
    expect(values.mc_success).toBe("87%");
  });

  it("resolves retirement_year as years[0].year + (retirementAge - years[0].ages.client)", () => {
    const values = resolveAllTokens(baseCtx);
    // 2026 + (65 - 55) = 2036
    expect(values.retirement_year).toBe("2036");
  });

  it("savings_by_account names every funded account, largest first, joined with 'and'", () => {
    expect(resolveAllTokens(baseCtx).savings_by_account).toBe(
      "$23,500 to Sam's 401(k) and $6,500 to Roth IRA",
    );
  });

  it("savings_by_account is null when no account received anything", () => {
    const ctx = withFirstYear({ savings: { total: 0, byAccount: {}, employerTotal: 0 } });
    expect(resolveAllTokens(ctx).savings_by_account).toBeNull();
  });

  it("savings_rate is the household rate as a whole percent, null with no salary", () => {
    expect(resolveAllTokens(baseCtx).savings_rate).toBe("25%");
    const ctx = withFirstYear({ income: { salaries: 0 } });
    expect(resolveAllTokens(ctx).savings_rate).toBeNull();
  });

  it("employer_contributions reads savings.employerTotal", () => {
    expect(resolveAllTokens(baseCtx).employer_contributions).toBe("$6,000");
  });

  it("annual_surplus reads netCashFlow and prints a negative with a real minus sign", () => {
    expect(resolveAllTokens(baseCtx).annual_surplus).toBe("−$4,200");
    const ctx = withFirstYear({ netCashFlow: 9100 });
    expect(resolveAllTokens(ctx).annual_surplus).toBe("$9,100");
  });

  it("years_to_retirement is spelled with its unit, and null once retired", () => {
    expect(resolveAllTokens(baseCtx).years_to_retirement).toBe("10 years");
    expect(resolveAllTokens(withFirstYear({ ages: { client: 64 } })).years_to_retirement).toBe("1 year");
    expect(resolveAllTokens(withFirstYear({ ages: { client: 65 } })).years_to_retirement).toBeNull();
    expect(resolveAllTokens(withFirstYear({ ages: { client: 70 } })).years_to_retirement).toBeNull();
  });

  it("largest_liability names the biggest beginning-of-year balance with its rate", () => {
    expect(resolveAllTokens(baseCtx).largest_liability).toBe("Mortgage ($400,000 at 6.25%)");
    const ctx = withFirstYear({ liabilityBalancesBoY: {} });
    expect(resolveAllTokens(ctx).largest_liability).toBeNull();
  });

  // In baseCtx the Mortgage happens to carry both the bigger balance AND the
  // bigger rate, so the test above alone would not catch a resolver that
  // ranked by interestRate instead of balance. Swap which liability has the
  // bigger balance while keeping each one's own rate fixed.
  it("largest_liability ranks by balance, not by interest rate", () => {
    const ctx = withFirstYear({ liabilityBalancesBoY: { l1: 5000, l2: 20000 } });
    expect(resolveAllTokens(ctx).largest_liability).toBe("Car loan ($20,000 at 4.9%)");
  });

  it("effective_tax_rate is taxes over total income, null with no income", () => {
    expect(resolveAllTokens(baseCtx).effective_tax_rate).toBe("20%");
    const ctx = withFirstYear({ totalIncome: 0 });
    expect(resolveAllTokens(ctx).effective_tax_rate).toBeNull();
  });
});

describe("renderTokens", () => {
  it("replaces known tokens and substitutes '—' for unknown tokens", () => {
    const values = resolveAllTokens(baseCtx);
    const result = renderTokens(
      "Net worth is {{net_worth}} ({{nope}})",
      values,
    );
    expect(result).toBe("Net worth is $1,738,000 (—)");
  });
});

describe("listTokens", () => {
  it("exposes id/label/category for every registered token", () => {
    const listed = listTokens();
    expect(listed.length).toBe(PLAN_TOKENS.length);
    for (const t of listed) {
      expect(typeof t.id).toBe("string");
      expect(typeof t.label).toBe("string");
      expect(["People", "Plan", "Balance Sheet", "Cash Flow", "Analysis"]).toContain(
        t.category,
      );
    }
  });
});

describe("PLAN_TOKENS resolve safety", () => {
  it("never throws — a resolver that throws yields null", () => {
    // Empty-ish context missing most fields; every resolve() should either
    // return a value or null, never throw.
    const brokenCtx = {
      clientData: {} as unknown as ClientData,
      projection: {} as unknown as ProjectionResult,
    };
    for (const token of PLAN_TOKENS) {
      expect(() => token.resolve(brokenCtx)).not.toThrow();
    }
  });
});
