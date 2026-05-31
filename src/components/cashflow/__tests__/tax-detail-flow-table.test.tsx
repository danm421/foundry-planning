import { describe, it, expect } from "vitest";
import {
  computeOtherTaxes,
  FLOW_COLUMNS,
  getSourcesForColumn,
  otherColumns,
} from "../tax-detail-flow-table";

const y = {
  trustTaxByEntity: new Map([["t1", { total: 4_000 }]]),
  estimatedBeneficiaryTax: 1_500,
  taxResult: {
    flow: {
      regularFederalIncomeTax: 30_000, capitalGainsTax: 2_000, amtAdditional: 0, niit: 0,
      additionalMedicare: 0, fica: 0, stateTax: 3_000, earlyWithdrawalPenalty: 0,
      totalTax: 35_000, // regularFed 30k + capGains 2k + state 3k  (NO trust/bene)
    },
    income: {},
    diag: {},
  },
} as never;

describe("tax-detail-flow-table — C3 Other = Total − Regular Fed", () => {
  it("C3: Regular Fed + Other = Total Tax (trust/bene excluded)", () => {
    const regular = FLOW_COLUMNS.find((c) => c.key === "regularFederalIncomeTax")!.value(y);
    const total = FLOW_COLUMNS.find((c) => c.key === "totalTax")!.value(y);
    expect(regular + computeOtherTaxes(y)).toBe(total); // 30k + 5k = 35k
  });

  it("C3: drill other_total = sum of federal component columns (trust/bene not summed)", () => {
    const cols = otherColumns([y]);
    const otherTotal = cols.find((c) => c.key === "other_total")!.value(y);
    const components = cols
      .filter((c) => !["other_total", "trustTax", "beneficiaryTax"].includes(c.key))
      .reduce((s, c) => s + c.value(y), 0);
    expect(components).toBe(otherTotal); // 5_000
    expect(otherTotal).toBe(5_000);
  });
});

describe("tax-detail-flow-table — H3 below-line drill popovers filter by category", () => {
  const dy = {
    deductionBreakdown: {
      belowLine: {
        charitable: 5_000,
        interestPaid: 8_000,
        itemizedTotal: 13_000,
        standardDeduction: 0,
        taxDeductions: 13_000,
        stateIncomeTax: 0,
        propertyTaxes: 0,
        taxesPaid: 0,
        otherItemized: 0,
        bySource: {
          g1: { label: "Charitable gift", amount: 5_000 },
          m1: { label: "Mortgage interest", amount: 8_000 },
        },
      },
    },
  } as never;

  it("H3: charitable popover rows sum to the Charitable cell, not all below-line sources", () => {
    const rows = getSourcesForColumn(dy, "bl_charitable")!;
    const sum = rows.reduce((s, r) => s + r.amount, 0);
    expect(sum).toBe(5_000);
  });

  it("H3: interest popover rows sum to the Interest Paid cell, not all below-line sources", () => {
    const rows = getSourcesForColumn(dy, "bl_interest_paid")!;
    const sum = rows.reduce((s, r) => s + r.amount, 0);
    expect(sum).toBe(8_000);
  });
});
