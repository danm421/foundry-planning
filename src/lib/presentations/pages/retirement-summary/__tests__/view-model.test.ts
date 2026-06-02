import { describe, it, expect } from "vitest";
import type { BuildDataContext } from "@/components/presentations/registry";
import { buildRetirementSummaryData } from "../view-model";
import { RETIREMENT_SUMMARY_OPTIONS_DEFAULT } from "../options-schema";

function ctx(over: Partial<BuildDataContext>): BuildDataContext {
  return {
    years: [],
    projection: {} as never,
    clientData: {
      client: { dateOfBirth: "1966-01-01", retirementAge: 65, spouseDob: null, spouseRetirementAge: null },
      clientName: "John Doe", spouseName: null,
      accounts: [], incomes: [], expenses: [],
      planSettings: {},
    } as never,
    scenarioLabel: "Base",
    clientName: "John Doe", spouseName: null,
    firmName: "Acme", firmTagline: null, reportDate: "2026-06-02",
    firmLogoDataUrl: null, accentColor: "#b87f1f",
    monteCarlo: null,
    ...over,
  } as unknown as BuildDataContext;
}

describe("buildRetirementSummaryData", () => {
  it("is empty when there are no projection years", () => {
    const data = buildRetirementSummaryData(ctx({}), RETIREMENT_SUMMARY_OPTIONS_DEFAULT);
    expect(data.isEmpty).toBe(true);
    expect(data.title).toBe("Retirement Summary");
  });

  it("flags married when a spouse SS income exists / spouse present", () => {
    const data = buildRetirementSummaryData(
      ctx({
        years: [{ year: 2031, portfolioAssets: { liquidTotal: 1, cashTotal: 0, taxableTotal: 0, retirementTotal: 0 }, accountLedgers: {}, income: { socialSecurity: 0, salaries: 0, business: 0, deferred: 0, capitalGains: 0, trust: 0, other: 0, bySource: {} }, expenses: { living: 0, insurance: 0, realEstate: 0, liabilities: 0, other: 0 }, withdrawals: { byAccount: {}, total: 0 }, totalExpenses: 0 }] as never,
        spouseName: "Jane Doe",
      }),
      RETIREMENT_SUMMARY_OPTIONS_DEFAULT,
    );
    expect(data.isEmpty).toBe(false);
    expect(data.isMarried).toBe(true);
  });

  it("surfaces the Monte Carlo success rate as a KPI string when present", () => {
    const data = buildRetirementSummaryData(
      ctx({
        years: [{ year: 2031, portfolioAssets: { liquidTotal: 100, cashTotal: 0, taxableTotal: 0, retirementTotal: 0 }, accountLedgers: {}, income: { socialSecurity: 0, salaries: 0, business: 0, deferred: 0, capitalGains: 0, trust: 0, other: 0, bySource: {} }, expenses: { living: 0, insurance: 0, realEstate: 0, liabilities: 0, other: 0 }, withdrawals: { byAccount: {}, total: 0 }, totalExpenses: 0 }] as never,
        monteCarlo: { summary: { successRate: 0.9 } } as never,
      }),
      RETIREMENT_SUMMARY_OPTIONS_DEFAULT,
    );
    expect(data.kpis.monteCarlo).toBe("90%");
  });
});
