import { describe, it, expect, beforeEach } from "vitest";
import { vi } from "vitest";
import type { ProjectionYear, ClientData } from "@/engine";
import { cashflowArtifact } from "../cashflow";
import type { CashflowData } from "../cashflow";

describe("cashflowArtifact (skeleton)", () => {
  it("registers id, title, section, route", () => {
    expect(cashflowArtifact.id).toBe("cashflow");
    expect(cashflowArtifact.title).toBe("Cash Flow");
    expect(cashflowArtifact.section).toBe("cashflow");
    expect(cashflowArtifact.route).toBe("/clients/[id]/cashflow");
  });

  it("declares variants chart, data, chart+data, csv", () => {
    expect(cashflowArtifact.variants.slice().sort()).toEqual([
      "chart",
      "chart+data",
      "csv",
      "data",
    ]);
  });

  it("optionsSchema parses an empty object to defaultOptions", () => {
    const parsed = cashflowArtifact.optionsSchema.parse({});
    expect(parsed).toEqual(cashflowArtifact.defaultOptions);
  });

  it("defaultOptions has nullable scenarioId and yearStart/yearEnd", () => {
    expect(cashflowArtifact.defaultOptions).toEqual({
      scenarioId: null,
      yearStart: null,
      yearEnd: null,
    });
  });

  it("toCsv exists", () => {
    expect(typeof cashflowArtifact.toCsv).toBe("function");
  });
});

function fixtureYear(overrides: Partial<ProjectionYear> = {}): ProjectionYear {
  return ({
    year: 2026,
    ages: { client: 60, spouse: 58 },
    income: {
      salaries: 200_000, socialSecurity: 0, business: 0, trust: 0, deferred: 0,
      capitalGains: 0, other: 0, total: 200_000, bySource: {},
    },
    withdrawals: { byAccount: {}, total: 0 },
    entityWithdrawals: { byAccount: {}, total: 0 },
    expenses: {
      living: 80_000, liabilities: 12_000, other: 5_000, insurance: 3_000,
      realEstate: 4_000, taxes: 30_000, cashGifts: 0, total: 134_000,
      bySource: {}, byLiability: {}, interestByLiability: {},
    },
    savings: { byAccount: {}, total: 0, employerTotal: 0 },
    totalIncome: 200_000,
    totalExpenses: 134_000,
    netCashFlow: 66_000,
    portfolioAssets: {
      taxable: { acct1: 500_000 }, cash: {}, retirement: {}, realEstate: {},
      business: {}, lifeInsurance: {},
      taxableTotal: 500_000, cashTotal: 0, retirementTotal: 0,
      realEstateTotal: 0, businessTotal: 0, lifeInsuranceTotal: 0,
      trustsAndBusinesses: {}, trustsAndBusinessesTotal: 0,
      accessibleTrustAssets: {}, accessibleTrustAssetsTotal: 0,
      total: 500_000,
    },
    accountLedgers: {
      acct1: {
        boyValue: 460_000, growth: 40_000, contributions: 0, distributions: 0,
        rmdAmount: 0,
      } as unknown as ProjectionYear["accountLedgers"][string],
    },
    accountBasisBoY: {},
    liabilityBalancesBoY: {},
    charitableOutflows: 0,
    ...overrides,
  }) as unknown as ProjectionYear;
}

describe("cashflowArtifact.fetchData (with mocked DB + projection)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("@/lib/scenario/loader", () => ({
      loadEffectiveTree: vi.fn().mockResolvedValue({
        effectiveTree: {
          client: { firstName: "Jane", lastName: "Doe", lifeExpectancy: 95, spouseLifeExpectancy: 95 },
        } as unknown as ClientData,
        warnings: [],
      }),
    }));
    vi.doMock("@/engine", async (orig) => {
      const actual = await orig() as Record<string, unknown>;
      return {
        ...actual,
        runProjection: vi.fn().mockReturnValue([fixtureYear()]),
      };
    });
  });

  it("returns base section with totals row", async () => {
    const { cashflowArtifact: art } = await import("../cashflow");
    const { data } = await art.fetchData({
      clientId: "c1",
      firmId: "f1",
      opts: { scenarioId: null, yearStart: null, yearEnd: null },
    });
    expect(data.clientName).toBe("Jane Doe");
    expect(data.sections.base.id).toBe("base");
    expect(data.sections.base.rows).toHaveLength(1);
    const row = data.sections.base.rows[0];
    expect(row.year).toBe(2026);
    expect(row.age).toBe("60 / 58");
    expect(row.cells.totalIncome).toBe(200_000);
    expect(row.cells.totalExpenses).toBe(134_000);
    expect(row.cells.netCashFlow).toBe(66_000);
    expect(data.sections.base.totals.totalIncome).toBe(200_000);
    expect(data.sections.base.totals.totalExpenses).toBe(134_000);
  });

  it("returns income section with category columns", async () => {
    const { runProjection } = await import("@/engine") as unknown as { runProjection: ReturnType<typeof vi.fn> };
    runProjection.mockReturnValue([
      fixtureYear({
        income: {
          salaries: 100_000, socialSecurity: 30_000, business: 50_000, trust: 0,
          deferred: 0, capitalGains: 20_000, other: 5_000,
          total: 205_000, bySource: {},
        },
      }),
    ]);
    const { cashflowArtifact: art } = await import("../cashflow");
    const { data } = await art.fetchData({
      clientId: "c1", firmId: "f1",
      opts: { scenarioId: null, yearStart: null, yearEnd: null },
    });
    const sec = data.sections.income;
    expect(sec.headers.map((h) => h.id)).toEqual([
      "year", "age", "salaries", "socialSecurity", "business", "trust",
      "deferred", "capitalGains", "other", "total",
    ]);
    expect(sec.rows[0].age).toBe("60 / 58");
    expect(sec.rows[0].cells.salaries).toBe(100_000);
    expect(sec.rows[0].cells.total).toBe(205_000);
    expect(sec.totals.total).toBe(205_000);
  });

  it("returns expenses section with category columns", async () => {
    const { runProjection } = await import("@/engine") as unknown as { runProjection: ReturnType<typeof vi.fn> };
    runProjection.mockReturnValue([
      fixtureYear({
        expenses: {
          living: 80_000, liabilities: 12_000, other: 5_000, insurance: 3_000,
          realEstate: 4_000, taxes: 30_000, cashGifts: 0, total: 134_000,
          bySource: {}, byLiability: {}, interestByLiability: {},
        },
      }),
    ]);
    const { cashflowArtifact: art } = await import("../cashflow");
    const { data } = await art.fetchData({
      clientId: "c1", firmId: "f1",
      opts: { scenarioId: null, yearStart: null, yearEnd: null },
    });
    const sec = data.sections.expenses;
    expect(sec.headers.map((h) => h.id)).toEqual([
      "year", "age", "living", "liabilities", "other", "insurance",
      "realEstate", "taxes", "total",
    ]);
    expect(sec.rows[0].cells.taxes).toBe(30_000);
    expect(sec.totals.total).toBe(134_000);
  });

  it("returns withdrawals section with growth, additions, distributions, netCashFlow", async () => {
    const { runProjection } = await import("@/engine") as unknown as { runProjection: ReturnType<typeof vi.fn> };
    runProjection.mockReturnValue([
      fixtureYear({
        netCashFlow: 66_000,
      }),
    ]);
    const { cashflowArtifact: art } = await import("../cashflow");
    const { data } = await art.fetchData({
      clientId: "c1", firmId: "f1",
      opts: { scenarioId: null, yearStart: null, yearEnd: null },
    });
    const sec = data.sections.withdrawals;
    expect(sec.headers.map((h) => h.id)).toEqual([
      "year", "age", "growth", "additions", "distributions", "netCashFlow",
    ]);
    expect(sec.rows[0].cells.growth).toBe(40_000);
    expect(sec.rows[0].cells.netCashFlow).toBe(66_000);
  });

  it("returns assets section with portfolio category columns", async () => {
    const { runProjection } = await import("@/engine") as unknown as { runProjection: ReturnType<typeof vi.fn> };
    runProjection.mockReturnValue([
      fixtureYear({
        portfolioAssets: {
          taxable: { acct1: 500_000 }, cash: {}, retirement: { acct2: 300_000 },
          realEstate: { acct3: 800_000 }, business: {}, lifeInsurance: {},
          taxableTotal: 500_000, cashTotal: 0, retirementTotal: 300_000,
          realEstateTotal: 800_000, businessTotal: 0, lifeInsuranceTotal: 0,
          trustsAndBusinesses: {}, trustsAndBusinessesTotal: 0,
          accessibleTrustAssets: {}, accessibleTrustAssetsTotal: 0,
          total: 1_600_000,
        },
      }),
    ]);
    const { cashflowArtifact: art } = await import("../cashflow");
    const { data } = await art.fetchData({
      clientId: "c1", firmId: "f1",
      opts: { scenarioId: null, yearStart: null, yearEnd: null },
    });
    const sec = data.sections.assets;
    expect(sec.headers.map((h) => h.id)).toEqual([
      "year", "age", "taxable", "cash", "retirement", "realEstate", "business",
      "lifeInsurance", "trustsAndBusinesses", "accessibleTrustAssets", "total",
    ]);
    expect(sec.rows[0].cells.taxable).toBe(500_000);
    expect(sec.rows[0].cells.realEstate).toBe(800_000);
    expect(sec.rows[0].cells.total).toBe(1_600_000);
    expect(sec.totals.total).toBe(1_600_000);
  });

  it("filters years to [yearStart, yearEnd] when both provided", async () => {
    const { runProjection } = await import("@/engine") as unknown as { runProjection: ReturnType<typeof vi.fn> };
    runProjection.mockReturnValue([
      fixtureYear({ year: 2026 }),
      fixtureYear({ year: 2027 }),
      fixtureYear({ year: 2028 }),
      fixtureYear({ year: 2029 }),
    ]);
    const { cashflowArtifact: art } = await import("../cashflow");
    const { data } = await art.fetchData({
      clientId: "c1", firmId: "f1",
      opts: { scenarioId: null, yearStart: 2027, yearEnd: 2028 },
    });
    expect(data.sections.base.rows.map((r) => r.year)).toEqual([2027, 2028]);
    expect(data.yearRange).toEqual([2027, 2028]);
  });
});

describe("cashflowArtifact.renderPdf", () => {
  const baseData: CashflowData = {
    clientName: "Doe Family",
    scenarioLabel: "Base Case",
    yearRange: [2026, 2026],
    sections: {
      base: {
        id: "base", title: "Cash Flow — Summary",
        headers: [
          { id: "year", label: "Year", align: "left" },
          { id: "age", label: "Age(s)", align: "left" },
          { id: "totalIncome", label: "Income", align: "right" },
          { id: "totalExpenses", label: "Expenses", align: "right" },
          { id: "netCashFlow", label: "Net Cash Flow", align: "right" },
          { id: "portfolioTotal", label: "Portfolio", align: "right" },
        ],
        rows: [{ year: 2026, age: "60 / 58", cells: { totalIncome: 200_000, totalExpenses: 134_000, netCashFlow: 66_000, portfolioTotal: 500_000 } }],
        totals: { totalIncome: 200_000, totalExpenses: 134_000, netCashFlow: 66_000, portfolioTotal: 500_000 },
      },
      income: { id: "income", title: "Income Detail", headers: [], rows: [], totals: {} },
      expenses: { id: "expenses", title: "Expenses Detail", headers: [], rows: [], totals: {} },
      withdrawals: { id: "withdrawals", title: "Net Cash Flow Detail", headers: [], rows: [], totals: {} },
      assets: { id: "assets", title: "Portfolio Detail", headers: [], rows: [], totals: {} },
    },
  };

  // Re-import cashflow.tsx without the engine/loader mocks from the earlier describe.
  beforeEach(() => {
    vi.resetModules();
    vi.unmock("@/lib/scenario/loader");
    vi.unmock("@/engine");
  });

  it("returns non-null view-blocks for variant=data (no charts)", async () => {
    const { cashflowArtifact: art } = await import("../cashflow");
    const node = art.renderPdf({
      data: baseData,
      opts: { scenarioId: null, yearStart: null, yearEnd: null },
      variant: "data",
      charts: [],
    });
    expect(node).not.toBeNull();
  });

  it("returns non-null view-blocks for variant=chart+data with no charts cached", async () => {
    const { cashflowArtifact: art } = await import("../cashflow");
    const node = art.renderPdf({
      data: baseData,
      opts: { scenarioId: null, yearStart: null, yearEnd: null },
      variant: "chart+data",
      charts: [],
    });
    expect(node).not.toBeNull();
  });

  it("returns non-null view-blocks for variant=chart with one cached chart", async () => {
    const { cashflowArtifact: art } = await import("../cashflow");
    const node = art.renderPdf({
      data: baseData,
      opts: { scenarioId: null, yearStart: null, yearEnd: null },
      variant: "chart",
      charts: [{
        id: "income",
        dataUrl: "data:image/png;base64,iVBORw0KGgo=",
        width: 400, height: 220, dataVersion: "v1",
      }],
    });
    expect(node).not.toBeNull();
  });
});
