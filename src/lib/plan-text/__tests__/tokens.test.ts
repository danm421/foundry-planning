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

const firstYear = {
  year: 2026,
  ages: { client: 55 },
  totalIncome: 150000,
  expenses: { total: 120000 },
  savings: { total: 30000 },
  portfolioAssets: { total: 2500000, liquidTotal: 1800000 },
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

  it("resolves net_worth as portfolioAssets.total minus liabilities", () => {
    const values = resolveAllTokens(baseCtx);
    // 2,500,000 - 400,000 = 2,100,000
    expect(values.net_worth).toBe("$2,100,000");
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
    expect(result).toBe("Net worth is $2,100,000 (—)");
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
