import { describe, it, expect, beforeEach } from "vitest";
import { vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { ArtifactDocument } from "@/components/pdf/artifact-document";
import { ensureFontsRegistered } from "@/components/pdf/fonts";
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
      taxable: { acct1: 500_000 }, cash: {}, retirement: {}, annuity: {}, realEstate: {},
      business: {}, lifeInsurance: {},
      taxableTotal: 500_000, cashTotal: 0, retirementTotal: 0,
      annuityTotal: 0,
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
          realEstate: 4_000, taxes: 30_000, cashGifts: 0, discretionary: 0, total: 134_000,
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
      "year", "age", "living", "discretionary", "liabilities", "other", "insurance",
      "realEstate", "taxes", "total",
    ]);
    expect(sec.rows[0].cells.taxes).toBe(30_000);
    expect(sec.totals.total).toBe(134_000);
  });

  it("returns withdrawals section with category, total, BoY, and withdrawal-% columns", async () => {
    const { runProjection } = await import("@/engine") as unknown as { runProjection: ReturnType<typeof vi.fn> };
    runProjection.mockReturnValue([
      fixtureYear({
        withdrawals: { byAccount: { acct1: 12_000 }, total: 12_000 },
      }),
    ]);
    const { cashflowArtifact: art } = await import("../cashflow");
    const { data } = await art.fetchData({
      clientId: "c1", firmId: "f1",
      opts: { scenarioId: null, yearStart: null, yearEnd: null },
    });
    const sec = data.sections.withdrawals;
    expect(sec.title).toBe("Withdrawals");
    // Without ClientData.accounts the category map can't classify acct1, so
    // no per-category columns appear — but the fixed summary trio always does.
    expect(sec.headers.map((h) => h.id)).toContain("totalWithdrawals");
    expect(sec.headers.map((h) => h.id)).toContain("portfolioBoY");
    expect(sec.headers.map((h) => h.id)).toContain("withdrawalPct");
    expect(sec.rows[0].cells.totalWithdrawals).toBe(12_000);
  });

  it("returns assets section with portfolio category columns", async () => {
    const { runProjection } = await import("@/engine") as unknown as { runProjection: ReturnType<typeof vi.fn> };
    runProjection.mockReturnValue([
      fixtureYear({
        portfolioAssets: {
          taxable: { acct1: 500_000 }, cash: {}, retirement: { acct2: 300_000 },
          annuity: {},
          realEstate: { acct3: 800_000 }, business: {}, lifeInsurance: {}, stockOptions: {},
          taxableTotal: 500_000, cashTotal: 0, retirementTotal: 300_000,
          annuityTotal: 0,
          realEstateTotal: 800_000, businessTotal: 0, lifeInsuranceTotal: 0, stockOptionsTotal: 0,
          trustsAndBusinesses: {}, trustsAndBusinessesTotal: 0,
          accessibleTrustAssets: {}, accessibleTrustAssetsTotal: 0,
          total: 1_600_000,
          liquidTotal: 800_000, // taxable 500k + retirement 300k (liquid investable)
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
      "year", "age", "taxable", "cash", "retirement", "annuity", "realEstate",
      "business", "lifeInsurance", "trustsAndBusinesses", "accessibleTrustAssets",
      "total",
    ]);
    expect(sec.rows[0].cells.taxable).toBe(500_000);
    expect(sec.rows[0].cells.realEstate).toBe(800_000);
    expect(sec.rows[0].cells.total).toBe(1_600_000);
    expect(sec.totals.total).toBe(1_600_000);
  });

  it("assets section carries the rider-crossover footnote when a $0 annuity balance still pays income", async () => {
    const { runProjection } = await import("@/engine") as unknown as { runProjection: ReturnType<typeof vi.fn> };
    runProjection.mockReturnValue([
      // Default fixtureYear() already has portfolioAssets.annuityTotal === 0;
      // adding a live "annuity:<id>" income entry is what should trip the
      // crossover — the guarantee paying after the account value is gone.
      fixtureYear({
        income: {
          salaries: 200_000, socialSecurity: 0, business: 0, trust: 0, deferred: 0,
          capitalGains: 0, other: 0, total: 200_000,
          bySource: { "annuity:acct9": 10_000 },
        },
      }),
    ]);
    const { cashflowArtifact: art } = await import("../cashflow");
    const { data } = await art.fetchData({
      clientId: "c1", firmId: "f1",
      opts: { scenarioId: null, yearStart: null, yearEnd: null },
    });
    expect(data.sections.assets.footnotes).toEqual([
      "A contract with a lifetime income rider can show a $0 balance while still paying — the guarantee continues after the account value is exhausted.",
    ]);
  });

  // The two tests above run on a fixture with NO `ClientData.accounts`, where
  // the account-list gate falls back to "don't know, do the scan". That means
  // neither of them watches the gate itself: the category string could be
  // typo'd and both stay green. These two supply a real accounts list, so the
  // string is load-bearing in exactly one direction each.
  it("finds the crossover through a populated account list (pins the category string)", async () => {
    const { loadEffectiveTree } = await import("@/lib/scenario/loader") as unknown as
      { loadEffectiveTree: ReturnType<typeof vi.fn> };
    loadEffectiveTree.mockResolvedValue({
      effectiveTree: {
        client: { firstName: "Jane", lastName: "Doe", lifeExpectancy: 95, spouseLifeExpectancy: 95 },
        accounts: [{ id: "acct9", name: "Deferred Annuity", category: "annuity" }],
      } as unknown as ClientData,
      warnings: [],
    });
    const { runProjection } = await import("@/engine") as unknown as { runProjection: ReturnType<typeof vi.fn> };
    runProjection.mockReturnValue([
      fixtureYear({
        income: {
          salaries: 200_000, socialSecurity: 0, business: 0, trust: 0, deferred: 0,
          capitalGains: 0, other: 0, total: 200_000,
          bySource: { "annuity:acct9": 10_000 },
        },
      }),
    ]);
    const { cashflowArtifact: art } = await import("../cashflow");
    const { data } = await art.fetchData({
      clientId: "c1", firmId: "f1",
      opts: { scenarioId: null, yearStart: null, yearEnd: null },
    });
    expect(data.sections.assets.footnotes).toHaveLength(1);
  });

  it("skips the scan when the household owns no annuity", async () => {
    const { loadEffectiveTree } = await import("@/lib/scenario/loader") as unknown as
      { loadEffectiveTree: ReturnType<typeof vi.fn> };
    loadEffectiveTree.mockResolvedValue({
      effectiveTree: {
        client: { firstName: "Jane", lastName: "Doe", lifeExpectancy: 95, spouseLifeExpectancy: 95 },
        accounts: [{ id: "acct1", name: "Brokerage", category: "taxable" }],
      } as unknown as ClientData,
      warnings: [],
    });
    const { runProjection } = await import("@/engine") as unknown as { runProjection: ReturnType<typeof vi.fn> };
    // The SAME crossover-shaped year as the test above. Only the account list
    // differs, so this is the gate and nothing else.
    runProjection.mockReturnValue([
      fixtureYear({
        income: {
          salaries: 200_000, socialSecurity: 0, business: 0, trust: 0, deferred: 0,
          capitalGains: 0, other: 0, total: 200_000,
          bySource: { "annuity:acct9": 10_000 },
        },
      }),
    ]);
    const { cashflowArtifact: art } = await import("../cashflow");
    const { data } = await art.fetchData({
      clientId: "c1", firmId: "f1",
      opts: { scenarioId: null, yearStart: null, yearEnd: null },
    });
    expect(data.sections.assets.footnotes).toBeUndefined();
  });

  it("assets section omits the rider-crossover footnote when the annuity balance is not $0 (no crossover on the page)", async () => {
    const { runProjection } = await import("@/engine") as unknown as { runProjection: ReturnType<typeof vi.fn> };
    runProjection.mockReturnValue([
      fixtureYear({
        income: {
          salaries: 200_000, socialSecurity: 0, business: 0, trust: 0, deferred: 0,
          capitalGains: 0, other: 0, total: 200_000,
          bySource: { "annuity:acct9": 10_000 },
        },
        portfolioAssets: {
          taxable: { acct1: 500_000 }, cash: {}, retirement: {},
          annuity: { acct9: 50_000 },
          realEstate: {}, business: {}, lifeInsurance: {}, stockOptions: {},
          taxableTotal: 500_000, cashTotal: 0, retirementTotal: 0,
          annuityTotal: 50_000,
          realEstateTotal: 0, businessTotal: 0, lifeInsuranceTotal: 0, stockOptionsTotal: 0,
          trustsAndBusinesses: {}, trustsAndBusinessesTotal: 0,
          accessibleTrustAssets: {}, accessibleTrustAssetsTotal: 0,
          total: 550_000,
          liquidTotal: 550_000,
        },
      }),
    ]);
    const { cashflowArtifact: art } = await import("../cashflow");
    const { data } = await art.fetchData({
      clientId: "c1", firmId: "f1",
      opts: { scenarioId: null, yearStart: null, yearEnd: null },
    });
    expect(data.sections.assets.footnotes).toBeUndefined();
  });

  it("assets section omits the rider-crossover footnote when there is no annuity at all", async () => {
    const { cashflowArtifact: art } = await import("../cashflow");
    // Default runProjection mock from beforeEach: fixtureYear() with
    // annuityTotal 0 and an empty income.bySource — no annuity income exists.
    const { data } = await art.fetchData({
      clientId: "c1", firmId: "f1",
      opts: { scenarioId: null, yearStart: null, yearEnd: null },
    });
    expect(data.sections.assets.footnotes).toBeUndefined();
  });

  it("M2: Other Inflows includes notes-receivable cash (matches on-screen noteTotal)", async () => {
    const { runProjection } = (await import("@/engine")) as unknown as {
      runProjection: ReturnType<typeof vi.fn>;
    };
    runProjection.mockReturnValue([
      fixtureYear({
        notesReceivableTotals: {
          interest: 5_000,
          principalLTCG: 10_000,
          principalBasis: 3_000,
          totalCashIn: 18_000,
          householdCashIn: 18_000,
        },
      }),
    ]);
    const { cashflowArtifact: art } = await import("../cashflow");
    const { data } = await art.fetchData({
      clientId: "c1",
      firmId: "f1",
      opts: { scenarioId: null, yearStart: null, yearEnd: null },
    });
    expect(data.sections.base.rows[0].cells.otherInflows).toBe(18_000);
    expect(data.sections.base.totals.otherInflows).toBe(18_000);
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

  // Real render: goes through the artifact's own renderPdf -> renderSection,
  // wrapped in the same ArtifactDocument the production export route uses
  // (src/app/api/clients/[id]/exports/pdf/route.tsx), then extracts real text
  // via pdftotext (poppler) -- following the established repo pattern in
  // src/components/presentations/shared/__tests__/detail-table-pdf.test.tsx.
  // This is the only way to catch a `renderSection` refactor that silently
  // drops the crossover footnote from the printed PDF: a hand-built
  // CashflowData fixture only proves the DATA carries `footnotes`; only a
  // real render proves the TEXT reaches the page.
  async function pdfTextFor(
    data: CashflowData,
    variant: "data" | "chart" | "chart+data" | "csv",
  ): Promise<string> {
    ensureFontsRegistered();
    const { cashflowArtifact: art } = await import("../cashflow");
    const blocks = art.renderPdf({
      data,
      opts: { scenarioId: null, yearStart: null, yearEnd: null },
      variant,
      charts: [],
    });
    // `renderToBuffer` is typed to take a `ReactElement<DocumentProps>` (the
    // `<Document>` react-pdf primitive), not an arbitrary wrapper component's
    // element -- that's only ever satisfied in production because JSX widens
    // to `JSX.Element` (`ReactElement<any, any>`). `React.createElement`
    // keeps the precise `FunctionComponentElement<ArtifactDocumentProps>`
    // type, which has no structural overlap with `DocumentProps`, so this
    // cast reproduces the same widening JSX gives for free. `ArtifactDocument`
    // renders a `<Document>` at its root (src/components/pdf/artifact-document.tsx),
    // which is what `renderToBuffer` actually needs at runtime.
    // `ArtifactDocumentProps.children` is required, not optional, so the
    // vararg form of `React.createElement` (props, ...children) fails to
    // resolve to the component overload at all -- TS falls through to an
    // unrelated intrinsic-element overload with a nonsensical error. Putting
    // `children` in the props object is the only way to satisfy that
    // required field without JSX, which is what react/no-children-prop is
    // built to flag -- but this file is `.ts`, so JSX isn't available (see
    // the addendum: don't rename to `.tsx` to get it).
    const pdf = await renderToBuffer(
      // eslint-disable-next-line react/no-children-prop -- required prop, no JSX in a .ts file
      React.createElement(ArtifactDocument, {
        householdName: data.clientName,
        artifactTitle: cashflowArtifact.title,
        reportYear: data.yearRange[1],
        firmName: "Test Firm",
        asOf: new Date("2026-01-01"),
        children: blocks,
      }) as unknown as Parameters<typeof renderToBuffer>[0],
    );
    const dir = mkdtempSync(join(tmpdir(), "cashflow-pdf-"));
    try {
      const file = join(dir, "cashflow.pdf");
      const text = join(dir, "cashflow.txt");
      writeFileSync(file, pdf);
      execFileSync("pdftotext", ["-layout", file, text]);
      return readFileSync(text, "utf8");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  const crossoverData: CashflowData = {
    clientName: "Doe Family",
    scenarioLabel: "Base Case",
    yearRange: [2026, 2026],
    sections: {
      base: { id: "base", title: "Cash Flow — Summary", headers: [], rows: [], totals: {} },
      income: { id: "income", title: "Income Detail", headers: [], rows: [], totals: {} },
      expenses: { id: "expenses", title: "Expenses Detail", headers: [], rows: [], totals: {} },
      withdrawals: { id: "withdrawals", title: "Net Cash Flow Detail", headers: [], rows: [], totals: {} },
      assets: {
        id: "assets",
        title: "Portfolio Detail",
        headers: [
          { id: "year", label: "Year", align: "left" },
          { id: "age", label: "Age(s)", align: "left" },
          { id: "annuity", label: "Annuity", align: "right" },
          { id: "total", label: "Total", align: "right" },
        ],
        rows: [{ year: 2026, age: "60 / 58", cells: { annuity: 0, total: 0 } }],
        totals: { annuity: 0, total: 0 },
        footnotes: [
          "A contract with a lifetime income rider can show a $0 balance while still paying — the guarantee continues after the account value is exhausted.",
        ],
      },
    },
  };

  it("prints the rider-crossover footnote in the real rendered PDF (variant=data)", async () => {
    const text = await pdfTextFor(crossoverData, "data");
    expect(text).toContain(
      "A contract with a lifetime income rider can show a $0 balance while still paying",
    );
  }, 20_000);

  it("does not print the footnote on the chart-only variant (showData guard)", async () => {
    const text = await pdfTextFor(crossoverData, "chart");
    expect(text).not.toContain("lifetime income rider");
  }, 20_000);
});

describe("cashflowArtifact.toCsv", () => {
  const data: CashflowData = {
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
      income: { id: "income", title: "Income Detail",
        headers: [{ id: "year", label: "Year", align: "left" }, { id: "salaries", label: "Salaries", align: "right" }, { id: "total", label: "Total", align: "right" }],
        rows: [{ year: 2026, age: "", cells: { salaries: 100_000, total: 100_000 } }],
        totals: { salaries: 100_000, total: 100_000 },
      },
      expenses: { id: "expenses", title: "Expenses Detail", headers: [], rows: [], totals: {} },
      withdrawals: { id: "withdrawals", title: "Net Cash Flow Detail", headers: [], rows: [], totals: {} },
      assets: { id: "assets", title: "Portfolio Detail", headers: [], rows: [], totals: {} },
    },
  };

  it("returns one file per non-empty section", async () => {
    const { cashflowArtifact: art } = await import("../cashflow");
    const files = art.toCsv!(data, { scenarioId: null, yearStart: null, yearEnd: null });
    const names = files.map((f) => f.name).sort();
    expect(names).toContain("cashflow-base.csv");
    expect(names).toContain("cashflow-income.csv");
    expect(names).not.toContain("cashflow-expenses.csv");  // empty section omitted
  });

  it("base CSV has header row, body row, and totals row", async () => {
    const { cashflowArtifact: art } = await import("../cashflow");
    const files = art.toCsv!(data, { scenarioId: null, yearStart: null, yearEnd: null });
    const base = files.find((f) => f.name === "cashflow-base.csv")!;
    const lines = base.contents.trim().split("\r\n");
    expect(lines[0]).toBe("Year,Age(s),Income,Expenses,Net Cash Flow,Portfolio");
    expect(lines[1]).toBe("2026,60 / 58,200000,134000,66000,500000");
    expect(lines[2]).toBe("TOTAL,,200000,134000,66000,500000");
  });
});
