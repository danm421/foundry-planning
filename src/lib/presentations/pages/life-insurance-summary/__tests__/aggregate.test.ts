// src/lib/presentations/pages/life-insurance-summary/__tests__/aggregate.test.ts
import { describe, it, expect } from "vitest";
import {
  fmtUsd,
  fmtPct,
  inventoryTotals,
  coverageForDecedent,
  gapFor,
  termExpiryLabel,
} from "../aggregate";
import type { LiPolicyRow } from "@/lib/insurance-policies/load-li-inventory";

function policy(over: Partial<LiPolicyRow>): LiPolicyRow {
  return {
    accountId: "a", name: "Term 20", policyType: "term",
    ownerLabel: "Cooper", insuredLabel: "Cooper", insuredPerson: "client",
    deathBenefit: 1_000_000, cashValue: 0, premiumAmount: 1_200,
    termExpiryYear: 2041, carrier: "Northwestern", beneficiaries: [],
    ...over,
  };
}

describe("aggregate", () => {
  it("formats currency and percent", () => {
    expect(fmtUsd(1_500_000)).toBe("$1.5M");
    expect(fmtUsd(250_000)).toBe("$250k");
    expect(fmtUsd(0)).toBe("$0");
    expect(fmtPct(0.9)).toBe("90%");
  });

  it("sums inventory totals", () => {
    const rows = [
      policy({ deathBenefit: 1_000_000, cashValue: 0, premiumAmount: 1_200 }),
      policy({ deathBenefit: 250_000, cashValue: 180_000, premiumAmount: 4_000 }),
    ];
    const t = inventoryTotals(rows);
    expect(t.count).toBe(2);
    expect(t.deathBenefit).toBe(1_250_000);
    expect(t.cashValue).toBe(180_000);
    expect(t.premium).toBe(5_200);
  });

  it("sums per-decedent coverage and excludes joint policies", () => {
    const rows = [
      policy({ insuredPerson: "client", deathBenefit: 1_000_000 }),
      policy({ insuredPerson: "spouse", deathBenefit: 500_000 }),
      policy({ insuredPerson: "joint", deathBenefit: 2_000_000 }),
    ];
    expect(coverageForDecedent(rows, "client").total).toBe(1_000_000);
    expect(coverageForDecedent(rows, "spouse").total).toBe(500_000);
    expect(coverageForDecedent(rows, "client").hasJoint).toBe(true);
  });

  it("computes surplus and shortfall gaps", () => {
    expect(gapFor(1_000_000, 2_000_000)).toEqual({ kind: "shortfall", amount: 1_000_000 });
    expect(gapFor(2_000_000, 1_500_000)).toEqual({ kind: "surplus", amount: 500_000 });
    expect(gapFor(1_000_000, 1_000_000)).toEqual({ kind: "met", amount: 0 });
  });

  it("labels term expiry, and dashes permanent policies", () => {
    expect(termExpiryLabel(policy({ policyType: "term", termExpiryYear: 2041 }))).toBe("2041");
    expect(termExpiryLabel(policy({ policyType: "whole", termExpiryYear: null }))).toBe("—");
  });
});
