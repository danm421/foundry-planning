// src/lib/reports/data-loader.test.ts
import { describe, it, expect, beforeAll } from "vitest";

import type { HypotheticalEstateTax, ProjectionYear } from "@/engine/types";
import type { Page } from "./types";

import {
  collectScopesFromTree,
  loadDataForScopes,
  buildWidgetData,
} from "./data-loader";
import { registerScope } from "./scope-registry";
import { registerWidget } from "./widget-registry";
import "./metrics"; // side-effect: register all v1 metrics

beforeAll(() => {
  // kpiTile may already be registered by other tests; re-registering is
  // idempotent and ensures this file works in isolation too.
  registerWidget({
    kind: "kpiTile",
    category: "KPI",
    label: "KPI Tile",
    description: "stub",
    allowedRowSizes: ["2-up", "3-up", "4-up"],
    defaultProps: { metricKey: "annualSavings", showDelta: false },
    Render: () => null,
    Inspector: () => null,
  });

  // Register the `cashflow` scope with a deterministic fetch return so the
  // loadDataForScopes / buildWidgetData passthrough tests can assert on it.
  registerScope({
    key: "cashflow",
    label: "Cashflow",
    fetch: () => ({ kind: "cashflow-fixture" }),
    serializeForAI: () => "cashflow-fixture",
  });
});

/**
 * Minimal `ProjectionYear` builder. Populates the fields the v1 metrics
 * actually read; the rest are stub-typed so the compiler is satisfied without
 * requiring a full estate-tax tree.
 */
function makeYear(overrides: Partial<ProjectionYear> = {}): ProjectionYear {
  return {
    year: 2026,
    ages: { client: 60 },
    income: {
      salaries: 0,
      socialSecurity: 0,
      business: 0,
      trust: 0,
      deferred: 0,
      capitalGains: 0,
      other: 0,
      total: 0,
      bySource: {},
    },
    withdrawals: { byAccount: {}, total: 0 },
    entityWithdrawals: { byAccount: {}, total: 0 },
    expenses: {
      living: 0,
      liabilities: 0,
      other: 0,
      insurance: 0,
      realEstate: 0,
      taxes: 0,
      cashGifts: 0,
      total: 0,
      bySource: {},
      byLiability: {},
      interestByLiability: {},
    },
    savings: { byAccount: {}, total: 30_000, employerTotal: 0 },
    totalIncome: 0,
    totalExpenses: 0,
    netCashFlow: 0,
    portfolioAssets: {
      taxable: {},
      cash: {},
      retirement: {},
      realEstate: {},
      business: {},
      lifeInsurance: {},
      taxableTotal: 0,
      cashTotal: 0,
      retirementTotal: 0,
      realEstateTotal: 0,
      businessTotal: 0,
      lifeInsuranceTotal: 0,
      trustsAndBusinesses: {},
      accessibleTrustAssets: {},
      trustsAndBusinessesTotal: 0,
      accessibleTrustAssetsTotal: 0,
      total: 0,
    },
    accountLedgers: {},
    accountBasisBoY: {},
    liabilityBalancesBoY: {},
    hypotheticalEstateTax: {} as unknown as HypotheticalEstateTax,
    entityCashFlow: new Map(),
    ...overrides,
  };
}

const clientCtx = { id: "c-1" };

function pageWith(...slots: Page["rows"][number]["slots"]): Page {
  return {
    id: "p1",
    orientation: "portrait",
    rows: [{ id: "r1", layout: "1-up", slots }],
  };
}

describe("collectScopesFromTree", () => {
  it("returns empty set for empty pages", () => {
    expect(collectScopesFromTree([])).toEqual(new Set());
  });

  it("returns empty set for a kpiTile (no declared scopes)", () => {
    const page = pageWith({
      id: "w1",
      kind: "kpiTile",
      props: { metricKey: "annualSavings", showDelta: false },
    });
    expect(collectScopesFromTree([page])).toEqual(new Set());
  });

  it("picks up scopes from aiAnalysis widget props", () => {
    // aiAnalysis has no registry entry in v1 — `safeWidgetScopes` falls back
    // to [], and the props.scopes branch supplies the dynamic list.
    const page = pageWith({
      id: "w-ai",
      kind: "aiAnalysis",
      props: {
        scopes: ["cashflow", "balance"],
        tone: "concise",
        length: "short",
        body: "",
      },
    });
    expect(collectScopesFromTree([page])).toEqual(
      new Set(["cashflow", "balance"]),
    );
  });
});

describe("loadDataForScopes", () => {
  it("returns {} for an empty input set", async () => {
    const out = await loadDataForScopes(new Set(), {
      client: clientCtx,
      projection: [],
    });
    expect(out).toEqual({});
  });

  it("fetches each registered scope in parallel", async () => {
    const out = await loadDataForScopes(new Set(["cashflow"]), {
      client: clientCtx,
      projection: [makeYear()],
    });
    expect(out).toEqual({ cashflow: { kind: "cashflow-fixture" } });
  });
});

describe("buildWidgetData", () => {
  it("resolves a kpiTile via the metric registry", () => {
    const page = pageWith({
      id: "kpi-1",
      kind: "kpiTile",
      props: { metricKey: "annualSavings", showDelta: false },
    });
    const out = buildWidgetData([page], {
      projection: [makeYear()],
      scopeData: {},
      client: clientCtx,
      accounts: [],
      liabilities: [],
      entities: [], familyMembers: [],
      household: { retirementYear: 2050, currentYear: 2026 },
    });
    expect(out).toEqual({
      "kpi-1": { value: 30_000, prevValue: null },
    });
  });

  it("throws for an unknown metricKey", () => {
    const page = pageWith({
      id: "kpi-bad",
      kind: "kpiTile",
      props: { metricKey: "doesNotExist", showDelta: false },
    });
    expect(() =>
      buildWidgetData([page], {
        projection: [makeYear()],
        scopeData: {},
        client: clientCtx,
        accounts: [],
        liabilities: [],
        entities: [], familyMembers: [],
        household: { retirementYear: 2050, currentYear: 2026 },
      }),
    ).toThrow();
  });

  it("slices cashflow scope years to the resolved yearRange", () => {
    // Build a 10-year cashflow scope fixture (2024-2033). The widget asks for
    // 2027-2030 — the data-loader must hand the chart only those 4 rows.
    const years = Array.from({ length: 10 }, (_, i) => ({
      year: 2024 + i,
      incomeWages: 0,
      incomeSocialSecurity: 0,
      incomePensions: 0,
      incomeWithdrawals: 0,
      incomeOther: 0,
      expenses: 0,
      savings: 0,
      net: 0,
    }));
    const page = pageWith({
      id: "cf-1",
      kind: "cashflowTable",
      props: {
        title: "Cashflow",
        yearRange: { from: 2027, to: 2030 },
        ownership: "consolidated",
        showTotals: false,
      },
    });
    const out = buildWidgetData([page], {
      projection: [makeYear()],
      scopeData: { cashflow: { years } },
      client: clientCtx,
      accounts: [],
      liabilities: [],
      entities: [], familyMembers: [],
      household: { retirementYear: 2050, currentYear: 2026 },
    });
    const sliced = (out["cf-1"] as { cashflow: { years: { year: number }[] } })
      .cashflow.years;
    expect(sliced.map((y) => y.year)).toEqual([2027, 2028, 2029, 2030]);
  });

  it("passes scopeData through unchanged for non-kpiTile widgets", () => {
    const page = pageWith({
      id: "ai-1",
      kind: "aiAnalysis",
      props: {
        scopes: ["cashflow"],
        tone: "concise",
        length: "short",
        body: "",
      },
    });
    const scopeData = { cashflow: { kind: "cashflow-fixture" } };
    const out = buildWidgetData([page], {
      projection: [makeYear()],
      scopeData,
      client: clientCtx,
      accounts: [],
      liabilities: [],
      entities: [], familyMembers: [],
      household: { retirementYear: 2050, currentYear: 2026 },
    });
    expect(out).toEqual({ "ai-1": scopeData });
  });
});
