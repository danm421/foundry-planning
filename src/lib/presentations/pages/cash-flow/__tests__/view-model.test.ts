import { describe, it, expect } from "vitest";
import { buildCashFlowPageData } from "../view-model";
import { makeProjectionYears, makeClientData } from "./fixtures";

describe("buildCashFlowPageData — retirement-onward range (default)", () => {
  const years = makeProjectionYears();
  const clientData = makeClientData();
  const data = buildCashFlowPageData({
    years,
    clientData,
    options: { range: "retirement", showCallout: true },
    scenarioLabel: "Base Case",
    clientName: "Cooper",
    spouseName: "Susan",
  });

  it("emits the page title and subtitle", () => {
    expect(data.title).toBe("Cash Flow");
    expect(data.subtitle).toBe("Base Case");
  });

  it("filters rows to retirement-onward years only (drops 2026)", () => {
    const years = data.table.rows.map((r) => r.year);
    expect(years).toEqual([2031, 2036, 2071]);
  });

  it("emits joint ages for living couple", () => {
    const r2031 = data.table.rows.find((r) => r.year === 2031);
    expect(r2031?.ageClient).toBe(65);
    expect(r2031?.ageSpouse).toBe(61);
  });

  it("populates table cells with engine fields", () => {
    const r2036 = data.table.rows.find((r) => r.year === 2036);
    expect(r2036?.cells.totalExpenses).toBe(140_000);
    expect(r2036?.cells.salary).toBe(0);
    expect(r2036?.cells.socialSecurity).toBe(33_000);
    expect(r2036?.cells.otherInflows).toBe(7_000); // 5000 business + 2000 capitalGains
    expect(r2036?.cells.totalIncome).toBe(100_000);
    expect(r2036?.cells.expenses).toBe(140_000);
    expect(r2036?.cells.savings).toBe(0);
    expect(r2036?.cells.netCashFlow).toBe(-40_000);
    expect(r2036?.cells.portfolioAssets).toBe(1_310_000); // taxable + cash + retirement + LI(0)
  });

  it("computes portfolio growth and activity from ledgers in years that have portfolio buckets populated", () => {
    // 2026 is the only fixture year with populated portfolioAssets buckets.
    const lifetime = buildCashFlowPageData({
      years,
      clientData,
      options: { range: "lifetime", showCallout: false },
      scenarioLabel: "Base Case",
      clientName: "Cooper",
      spouseName: "Susan",
    });
    const r2026 = lifetime.table.rows.find((r) => r.year === 2026);
    // growth = 12_000 (brokerage) + 8_000 (ira)
    expect(r2026?.cells.portfolioGrowth).toBe(20_000);
    // activity = external contributions − external distributions
    //         = (20_000 + 30_000) − 0 = 50_000
    expect(r2026?.cells.portfolioActivity).toBe(50_000);
  });

  it("includes the default callout when range = retirement", () => {
    expect(data.callout).toBe("Cash flow begins at Retirement.");
  });
});

describe("buildCashFlowPageData — lifetime range", () => {
  const data = buildCashFlowPageData({
    years: makeProjectionYears(),
    clientData: makeClientData(),
    options: { range: "lifetime", showCallout: true },
    scenarioLabel: "Base Case",
    clientName: "Cooper",
    spouseName: "Susan",
  });

  it("includes all years including pre-retirement", () => {
    expect(data.table.rows.map((r) => r.year)).toEqual([2026, 2031, 2036, 2071]);
  });

  it("populates salary in pre-retirement rows", () => {
    const r2026 = data.table.rows.find((r) => r.year === 2026);
    expect(r2026?.cells.salary).toBe(200_000);
  });

  it("suppresses the callout in lifetime mode by default", () => {
    expect(data.callout).toBeUndefined();
  });
});

describe("buildCashFlowPageData — explicit range", () => {
  const data = buildCashFlowPageData({
    years: makeProjectionYears(),
    clientData: makeClientData(),
    options: { range: { startYear: 2031, endYear: 2036 }, showCallout: false },
    scenarioLabel: "Base Case",
    clientName: "Cooper",
    spouseName: "Susan",
  });

  it("filters to the explicit window inclusive of both ends", () => {
    expect(data.table.rows.map((r) => r.year)).toEqual([2031, 2036]);
  });
});

describe("buildCashFlowPageData — RMD splitting", () => {
  const data = buildCashFlowPageData({
    years: makeProjectionYears(),
    clientData: makeClientData(),
    options: { range: "retirement", showCallout: false },
    scenarioLabel: "Base Case",
    clientName: "Cooper",
    spouseName: "Susan",
  });

  // Each RMD writes two `category: "rmd"` ledger entries (a `-rmd` distribution
  // on the source account and a `+rmd` credit on checking). RMDs must be summed
  // once via `rmdAmount`, NOT by abs-summing those entries — otherwise the
  // column reports double the true RMD. The fixtures reproduce both entries.
  it("reports rmds once (not double-counted from the paired ledger entries)", () => {
    const r2031 = data.table.rows.find((r) => r.year === 2031);
    expect(r2031?.cells.rmds).toBe(40_000);              // single rmdAmount, not 80k
    expect(r2031?.cells.withdrawals).toBe(40_000);       // engine withdrawals.total

    const r2071 = data.table.rows.find((r) => r.year === 2071);
    expect(r2071?.cells.rmds).toBe(50_000);              // single rmdAmount, not 100k
    expect(r2071?.cells.withdrawals).toBe(0);             // no supplemental withdrawals
  });

  // F81: the engine sets `rmdAmount` on the ledger of EVERY rmd-enabled account
  // (projection.ts:1404), but entity-owned (non-IIP trust) accounts route their
  // RMD to entity checking, not to householdRmdIncome/totalIncome. Summing every
  // ledger's rmdAmount therefore over-counts the household RMD bar so the stacked
  // total no longer reconciles to totalIncome. The RMD scan must be scoped to the
  // household-portfolio accounts (the same `portfolioAccountIds` set the growth /
  // activity columns already use). 2036's fixture has an entity-owned `trustIra`
  // (rmdAmount 25k, in trustsAndBusinesses) alongside the household `ira` (60k).
  it("excludes entity-owned RMDs from the household RMD column", () => {
    const r2036 = data.table.rows.find((r) => r.year === 2036);
    expect(r2036?.cells.rmds).toBe(60_000); // household ira only, NOT 85k (incl. trustIra)
  });
});

describe("buildCashFlowPageData — chart stack vs Total Expenses line", () => {
  const data = buildCashFlowPageData({
    years: makeProjectionYears(),
    clientData: makeClientData(),
    options: { range: "lifetime", showCallout: false },
    scenarioLabel: "Base Case",
    clientName: "Cooper",
    spouseName: "Susan",
  });

  // In retirement the gap-fill withdrawal sizes the stack to exactly meet
  // expenses, so the stacked bar tops out on the Total Expenses line. A
  // double-counted RMD would push the bar above the line (the original PDF bug).
  it("stacked bar tops out at the Total Expenses line in an RMD year (2036)", () => {
    const { stacks, lines, xAxis } = data.chartSpec;
    const i = xAxis.domain.indexOf(2036);
    expect(i).toBeGreaterThanOrEqual(0);
    const stackTotal = stacks.reduce((sum, s) => sum + s.values[i], 0);
    expect(stackTotal).toBe(lines[0].values[i]);
    expect(stackTotal).toBe(140_000); // ss 33k + other 7k + rmd 60k + withdrawal 40k
  });
});

describe("buildCashFlowPageData — markers", () => {
  const data = buildCashFlowPageData({
    years: makeProjectionYears(),
    clientData: makeClientData(),
    options: { range: "lifetime", showCallout: false },
    scenarioLabel: "Base Case",
    clientName: "Cooper",
    spouseName: "Susan",
  });

  it("collapses same-year retirements into a single joint marker", () => {
    // Cooper retires 1966+65=2031; Susan retires 1970+61=2031. Same year → joint collapse.
    const retirementMarkers = data.table.markers.filter((m) => m.kind === "retirement");
    expect(retirementMarkers).toHaveLength(1);
    expect(retirementMarkers[0]).toMatchObject({
      year: 2031,
      who: "joint",
      kind: "retirement",
    });
    expect(retirementMarkers[0].label).toContain("Cooper");
    expect(retirementMarkers[0].label).toContain("Susan");
  });

  it("labels client-only end-of-life with client name", () => {
    // Cooper dies 1966+100=2066, Susan dies 1970+99=2069. Separate years → separate markers.
    const eol = data.table.markers.find((m) => m.kind === "endOfLife" && m.who === "client");
    expect(eol?.label).toContain("Cooper");
  });

  it("labels spouse-only end-of-life with spouse name", () => {
    const eol = data.table.markers.find((m) => m.kind === "endOfLife" && m.who === "spouse");
    expect(eol?.label).toContain("Susan");
  });
});

describe("buildCashFlowPageData — explicit callout text", () => {
  it("uses options.calloutText when provided", () => {
    const data = buildCashFlowPageData({
      years: makeProjectionYears(),
      clientData: makeClientData(),
      options: { range: "lifetime", showCallout: true, calloutText: "Custom note." },
      scenarioLabel: "Base Case",
      clientName: "Cooper",
      spouseName: "Susan",
    });
    expect(data.callout).toBe("Custom note.");
  });
});
