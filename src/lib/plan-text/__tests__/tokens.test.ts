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
} as unknown as ClientData;

// Year 1 is deliberately "grown": every EoY bucket sits above its ledger's
// beginningValue, so a resolver that reads the end-of-year snapshot instead of
// the beginning-of-year one produces a visibly different number.
const firstYear = {
  year: 2026,
  ages: { client: 55 },
  totalIncome: 150000,
  expenses: { total: 120000 },
  savings: { total: 30000 },
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
  liabilityBalancesBoY: { l1: 400000 },
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
    // (1,500,000 + 650,000) - 400,000 = 1,750,000
    expect(values.net_worth).toBe("$1,750,000");
  });

  it("resolves portfolio_assets from the beginning-of-year liquid total", () => {
    const values = resolveAllTokens(baseCtx);
    expect(values.portfolio_assets).toBe("$1,500,000");
  });

  it("resolves total_liabilities from the beginning-of-year liability balances", () => {
    const values = resolveAllTokens(baseCtx);
    expect(values.total_liabilities).toBe("$400,000");
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
});

describe("renderTokens", () => {
  it("replaces known tokens and substitutes '—' for unknown tokens", () => {
    const values = resolveAllTokens(baseCtx);
    const result = renderTokens(
      "Net worth is {{net_worth}} ({{nope}})",
      values,
    );
    expect(result).toBe("Net worth is $1,750,000 (—)");
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
