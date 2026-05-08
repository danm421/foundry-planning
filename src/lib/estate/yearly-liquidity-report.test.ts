import { describe, it, expect } from "vitest";
import type { ClientData, ProjectionResult } from "@/engine/types";
import { buildYearlyLiquidityReport } from "./yearly-liquidity-report";

const NAMES = { clientName: "Alice", spouseName: "Bob" };
const DOBS = { clientDob: "1960-01-01", spouseDob: "1962-01-01" };

function emptyClientData(): ClientData {
  return {
    client: {
      firstName: "Alice",
      lastName: "X",
      dateOfBirth: "1960-01-01",
      retirementAge: 65,
      planEndAge: 95,
      filingStatus: "married_joint",
      spouseName: "Bob",
      spouseDob: "1962-01-01",
      spouseRetirementAge: 65,
    },
    accounts: [],
    liabilities: [],
    incomes: [],
    expenses: [],
    familyMembers: [],
    entities: [],
    externalBeneficiaries: [],
    gifts: [],
    giftEvents: [],
    bequests: [],
    beneficiaryDesignations: [],
    planSettings: {
      planStartYear: 2026,
      inflationRate: 0.03,
    },
  } as unknown as ClientData;
}

function emptyProjection(): ProjectionResult {
  return {
    years: [],
    firstDeathEvent: null,
    secondDeathEvent: null,
    todayHypotheticalEstateTax: null,
  } as unknown as ProjectionResult;
}

describe("buildYearlyLiquidityReport", () => {
  it("returns empty rows and zero totals when projection has no years", () => {
    const report = buildYearlyLiquidityReport({
      projection: emptyProjection(),
      clientData: emptyClientData(),
      ownerNames: NAMES,
      ownerDobs: DOBS,
    });
    expect(report.rows).toEqual([]);
    expect(report.totals.totalInsuranceBenefit).toBe(0);
    expect(report.totals.totalPortfolioAssets).toBe(0);
    expect(report.totals.totalTransferCost).toBe(0);
    expect(report.totals.surplusDeficitWithPortfolio).toBe(0);
    expect(report.totals.surplusDeficitInsuranceOnly).toBe(0);
  });
});
