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
