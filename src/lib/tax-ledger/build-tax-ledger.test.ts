// src/lib/tax-ledger/build-tax-ledger.test.ts
import { describe, expect, it } from "vitest";
import type { ProjectionYear } from "@/engine/types";
import type { CellDrillContext } from "@/lib/tax/cell-drill/types";
import { buildTaxLedger } from "./build-tax-ledger";

const ctx = { accountNames: { ira: "Traditional IRA" }, incomes: [], accounts: [] } as unknown as CellDrillContext;

function fixtureYear(): ProjectionYear {
  return {
    year: 2032,
    income: { socialSecurity: 0 } as ProjectionYear["income"],
    taxDetail: {
      earnedIncome: 0, ordinaryIncome: 52000, dividends: 0, capitalGains: 0,
      stCapitalGains: 0, qbi: 0, taxExempt: 0, taxExemptInterest: 0,
      bySource: { "ira:rmd": { type: "ordinary_income", amount: 52000 } },
    },
    deductionBreakdown: { aboveLine: { bySource: {} }, belowLine: { bySource: {} } } as unknown as ProjectionYear["deductionBreakdown"],
    entityCashFlow: new Map(),
    taxResult: {
      income: { taxableSocialSecurity: 0 },
      flow: { adjustedGrossIncome: 52000, taxableIncome: 25000, incomeTaxBase: 25000, regularFederalIncomeTax: 2800, capitalGainsTax: 0, niit: 0, additionalMedicare: 0, fica: 0, stateTax: 0, totalFederalTax: 2800, totalTax: 2800, earlyWithdrawalPenalty: 0, amtAdditional: 0 },
      diag: { marginalFederalRate: 0.12, effectiveFederalRate: 0.05, marginalBracketTier: { from: 0, to: 90000, rate: 0.12 }, bracketsUsed: { niitRate: 0.038, niitThreshold: { mfj: 250000, single: 200000, mfs: 125000 } } },
    } as unknown as ProjectionYear["taxResult"],
  } as unknown as ProjectionYear;
}

describe("buildTaxLedger", () => {
  it("assembles year, household section, and diagnostics", () => {
    const ledger = buildTaxLedger(fixtureYear(), ctx, { householdLabel: "Household", filingStatus: "married_joint" });
    expect(ledger.year).toBe(2032);
    expect(ledger.sections[0].kind).toBe("household");
    expect(ledger.sections[0].rows.find((r) => r.type === "RMD")).toBeDefined();
    expect(ledger.diagnostics.totalTax).toBe(2800);
  });
});
