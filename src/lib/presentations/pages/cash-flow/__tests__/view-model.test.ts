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
    expect(r2036?.cells.otherIncome).toBe(7_000); // 5000 business + 2000 capitalGains
    expect(r2036?.cells.totalPortfolioAssets).toBe(1_310_000);
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

  it("splits rmds from discretionary withdrawals using ledger categories", () => {
    const r2031 = data.table.rows.find((r) => r.year === 2031);
    expect(r2031?.cells.rmds).toBe(40_000);                  // ledger entry category=rmd
    expect(r2031?.cells.withdrawals).toBe(40_000);            // total − rmds
    expect(r2031?.cells.totalWithdrawalsSpent).toBe(80_000); // engine total

    const r2071 = data.table.rows.find((r) => r.year === 2071);
    expect(r2071?.cells.rmds).toBe(50_000);
    expect(r2071?.cells.withdrawals).toBe(0); // all 50k was rmd
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
    // new Date("1966-01-01").getFullYear() = 1965 (UTC midnight → prev day in local TZ).
    // Cooper retires at 1965+65=2030; Susan retires at 1969+61=2030. Same year → joint collapse.
    const retirementMarkers = data.table.markers.filter((m) => m.kind === "retirement");
    expect(retirementMarkers).toHaveLength(1);
    expect(retirementMarkers[0]).toMatchObject({
      year: 2030,
      who: "joint",
      kind: "retirement",
    });
    expect(retirementMarkers[0].label).toContain("Cooper");
    expect(retirementMarkers[0].label).toContain("Susan");
  });

  it("labels client-only end-of-life with client name", () => {
    // Cooper dies 1965+100=2065, Susan dies 1969+99=2068. Separate years → separate markers.
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
