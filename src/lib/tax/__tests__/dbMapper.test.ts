import { describe, it, expect } from "vitest";
import { dbRowToTaxYearParameters } from "../dbMapper";

// Minimal row: only the fields this test asserts on, cast through unknown.
// The mapper reads every column, so absent ones come back NaN — that's fine,
// we assert only on the new blocks.
const row = {
  year: 2026,
  incomeBrackets: {}, capGainsBrackets: {},
  trustIncomeBrackets: null, trustCapGainsBrackets: null,
  rothPhaseoutStartMfj: "242000.00", rothPhaseoutEndMfj: "252000.00",
  rothPhaseoutStartSingle: "153000.00", rothPhaseoutEndSingle: "168000.00",
  iraDeductCoveredStartMfj: "129000.00", iraDeductCoveredEndMfj: "149000.00",
  iraDeductCoveredStartSingle: "81000.00", iraDeductCoveredEndSingle: "91000.00",
  iraDeductSpousalStartMfj: "242000.00", iraDeductSpousalEndMfj: "252000.00",
  studentLoanMaxDeduction: "2500.00",
  studentLoanPhaseoutStartMfj: "175000.00", studentLoanPhaseoutEndMfj: "205000.00",
  studentLoanPhaseoutStartSingle: "85000.00", studentLoanPhaseoutEndSingle: "100000.00",
  ctcPerChild: "2200.00", ctcRefundableMax: "1700.00", odcPerDependent: "500.00",
  saversCreditTiersMfj: [
    { rate: 0.5, agiCeiling: 48500 },
    { rate: 0.2, agiCeiling: 52500 },
    { rate: 0.1, agiCeiling: 80500 },
  ],
  saversCreditTiersSingle: [
    { rate: 0.5, agiCeiling: 24250 },
    { rate: 0.2, agiCeiling: 26250 },
    { rate: 0.1, agiCeiling: 40250 },
  ],
  saversCreditTiersHoh: [
    { rate: 0.5, agiCeiling: 36375 },
    { rate: 0.2, agiCeiling: 39375 },
    { rate: 0.1, agiCeiling: 60375 },
  ],
} as unknown as Parameters<typeof dbRowToTaxYearParameters>[0];

describe("dbRowToTaxYearParameters — threshold columns", () => {
  it("maps the Roth phaseout range", () => {
    const p = dbRowToTaxYearParameters(row);
    expect(p.rothPhaseout).toEqual({
      startMfj: 242000, endMfj: 252000, startSingle: 153000, endSingle: 168000,
    });
  });

  it("maps both IRA-deductibility ranges", () => {
    const p = dbRowToTaxYearParameters(row);
    expect(p.iraDeduct.coveredStartMfj).toBe(129000);
    expect(p.iraDeduct.coveredEndSingle).toBe(91000);
    expect(p.iraDeduct.spousalStartMfj).toBe(242000);
  });

  it("maps the student-loan cap and range", () => {
    const p = dbRowToTaxYearParameters(row);
    expect(p.studentLoan.maxDeduction).toBe(2500);
    expect(p.studentLoan.startMfj).toBe(175000);
  });

  it("maps CTC amounts", () => {
    const p = dbRowToTaxYearParameters(row);
    expect(p.ctc).toEqual({ perChild: 2200, refundableMax: 1700, odcPerDependent: 500 });
  });

  it("passes Saver's tiers through as arrays", () => {
    const p = dbRowToTaxYearParameters(row);
    expect(p.saversCredit.mfj).toHaveLength(3);
    expect(p.saversCredit.mfj[0]).toEqual({ rate: 0.5, agiCeiling: 48500 });
  });

  it("tolerates null threshold columns on un-reseeded rows", () => {
    const bare = { ...row, ctcPerChild: null, saversCreditTiersMfj: null } as typeof row;
    const p = dbRowToTaxYearParameters(bare);
    expect(p.ctc.perChild).toBeNull();
    expect(p.saversCredit.mfj).toEqual([]);
  });
});
