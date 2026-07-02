// src/lib/presentations/pages/life-insurance-summary/__tests__/aggregate.test.ts
import { describe, it, expect } from "vitest";
import {
  fmtUsd,
  fmtPct,
  inventoryTotals,
  coverageForDecedent,
  isInForce,
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
      policy({ insuredPerson: "client", deathBenefit: 1_000_000, policyType: "whole", termExpiryYear: null }),
      policy({ insuredPerson: "spouse", deathBenefit: 500_000, policyType: "whole", termExpiryYear: null }),
      policy({ insuredPerson: "joint", deathBenefit: 2_000_000, policyType: "whole", termExpiryYear: null }),
    ];
    expect(coverageForDecedent(rows, "client", 2030).total).toBe(1_000_000);
    expect(coverageForDecedent(rows, "spouse", 2030).total).toBe(500_000);
    expect(coverageForDecedent(rows, "client", 2030).hasJoint).toBe(true);
  });

  it("reports in-force status: permanent always, term through its expiry year inclusive", () => {
    const term = policy({ policyType: "term", termExpiryYear: 2041 });
    expect(isInForce(term, 2041)).toBe(true);  // in force through expiry year
    expect(isInForce(term, 2042)).toBe(false); // dropped the year after
    const whole = policy({ policyType: "whole", termExpiryYear: null });
    expect(isInForce(whole, 2099)).toBe(true);
  });

  it("excludes expired term coverage as of the death year, matching the solved need", () => {
    const rows = [
      // A term policy that lapses in 2041 and a permanent policy.
      policy({ insuredPerson: "client", deathBenefit: 1_000_000, policyType: "term", termExpiryYear: 2041 }),
      policy({ insuredPerson: "client", deathBenefit: 250_000, policyType: "whole", termExpiryYear: null }),
    ];
    // At a 2048 death the term is gone → only the $250k permanent policy counts.
    expect(coverageForDecedent(rows, "client", 2048).total).toBe(250_000);
    // At a 2035 death both are in force.
    expect(coverageForDecedent(rows, "client", 2035).total).toBe(1_250_000);
  });

  it("does not footnote a joint policy that has already expired", () => {
    const rows = [
      policy({ insuredPerson: "joint", deathBenefit: 2_000_000, policyType: "term", termExpiryYear: 2040 }),
    ];
    expect(coverageForDecedent(rows, "client", 2050).hasJoint).toBe(false);
    expect(coverageForDecedent(rows, "client", 2035).hasJoint).toBe(true);
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
