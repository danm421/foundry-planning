import { describe, it, expect } from "vitest";
import {
  computeOtherTaxes,
  FLOW_COLUMNS,
  getSourcesForColumn,
  otherColumns,
} from "../tax-detail-flow-table";

// A credit-claiming household, traced through calculate.ts's roll-up so the
// numbers are the engine's rather than invented:
//   subpartA        = regularFed 30,000 + capGains 2,000 + AMT 0        = 32,000
//   totalFederalTax = max(0, 32,000 − nonrefundable 1,200) − refundable 800
//                                                                       = 30,000
//   totalTax        = 30,000 + state 3,000 + FICA 0                     = 33,000
//   Other           = totalTax − regularFed (PRE-credit)                =  3,000
// The named component columns alone sum to 5,000 — they OVERSHOOT Other by
// exactly the 2,000 of credits. Before Task 14b's fix round 1 this fixture
// carried NO credits, which is the only reason the C3 drill assertion below
// passed: a real guard rendered vacuous by its fixture.
// Built through a factory rather than by spreading `y`: the fixtures are cast
// `as never` for brevity, and `never` cannot be spread (tsc TS2698).
function makeYear(flowOver: Record<string, number>) {
  return {
    trustTaxByEntity: new Map([["t1", { total: 4_000 }]]),
    estimatedBeneficiaryTax: 1_500,
    taxResult: {
      flow: {
        regularFederalIncomeTax: 30_000, capitalGainsTax: 2_000, amtAdditional: 0, niit: 0,
        additionalMedicare: 0, fica: 0, stateTax: 3_000, earlyWithdrawalPenalty: 0,
        taxCredits: 0, refundableCredits: 0,
        totalTax: 35_000,
        ...flowOver,
      },
      income: {},
      diag: {},
    },
  } as never;
}

const y = makeYear({
  taxCredits: 1_200,
  refundableCredits: 800,
  totalTax: 33_000, // regularFed 30k + capGains 2k + state 3k − credits 2k (NO trust/bene)
});

// Same household with the credits removed — totalTax reverts to 35,000.
const yNoCredits = makeYear({});

describe("tax-detail-flow-table — C3 Other = Total − Regular Fed", () => {
  it("C3: Regular Fed + Other = Total Tax (trust/bene excluded)", () => {
    const regular = FLOW_COLUMNS.find((c) => c.key === "regularFederalIncomeTax")!.value(y);
    const total = FLOW_COLUMNS.find((c) => c.key === "totalTax")!.value(y);
    expect(regular + computeOtherTaxes(y)).toBe(total); // 30k + 3k = 33k
  });

  // Split into two `it`s (Task 14b fix round 1). These were stacked in ONE block,
  // and when the fixture gained credits BOTH went wrong at once — but the first
  // threw, so the second never executed and its stale `5_000` literal was never
  // reported. One load-bearing assertion per block; the masking cannot recur.
  it("C3: drill other_total = sum of federal component columns (trust/bene not summed)", () => {
    const cols = otherColumns([y]);
    const otherTotal = cols.find((c) => c.key === "other_total")!.value(y);
    const components = cols
      .filter((c) => !["other_total", "trustTax", "beneficiaryTax"].includes(c.key))
      .reduce((s, c) => s + c.value(y), 0);
    // capGains 2,000 + state 3,000 + credits (−2,000) = 3,000
    expect(components).toBe(otherTotal);
  });

  it("C3: drill other_total = Total Tax − Regular Fed", () => {
    const cols = otherColumns([y]);
    expect(cols.find((c) => c.key === "other_total")!.value(y)).toBe(3_000);
  });

  it("C3: the credits column carries BOTH credit kinds, as a negative", () => {
    // Nonrefundable 1,200 + refundable 800, entering the bucket as a reduction.
    // One assertion covers presence, sign, and both kinds — if the column were
    // filtered out, find() returns undefined and this throws on the `!`.
    expect(otherColumns([y]).find((c) => c.key === "credits")!.value(y)).toBe(-2_000);
  });

  it("C3: the credits column sits to the LEFT of Other Total", () => {
    // POSITION is load-bearing, not cosmetic: this file's invariants are written
    // as "the components to its LEFT sum to it". Moving credits into the
    // informational region right of Other Total leaves every value assertion
    // green while the rendered table contradicts both written invariants.
    const keys = otherColumns([y]).map((c) => c.key);
    expect(keys.indexOf("credits")).toBeLessThan(keys.indexOf("other_total"));
  });

  it("C3: the credits column is zero-suppressed when no year claims a credit", () => {
    // The column must vanish, like every other component column, via
    // otherColumns()'s own filter.
    expect(otherColumns([yNoCredits]).map((c) => c.key)).not.toContain("credits");
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
