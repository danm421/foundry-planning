// src/lib/timeline/__tests__/detectors/insurance.test.ts
import { describe, it, expect } from "vitest";
import { detectInsuranceEvents } from "../../detectors/insurance";
import { runProjection } from "@/engine";
import { buildClientData } from "@/engine/__tests__/fixtures";
import type { LifeInsurancePolicy } from "@/engine/types";
import { LEGACY_FM_CLIENT } from "../../../../engine/ownership";

describe("detectInsuranceEvents", () => {
  it("returns empty array when no life-insurance accounts exist", () => {
    const data = buildClientData();
    const projection = runProjection(data);
    const events = detectInsuranceEvents(data, projection);
    // Fixture has no life_insurance accounts.
    expect(events).toEqual([]);
  });

  it("emits a life-insurance-proceeds event in the death year when a life_insurance account distributes", () => {
    const data = buildClientData();
    data.accounts = [
      ...data.accounts,
      {
        id: "acct-life-ins",
        name: "Life policy",
        category: "life_insurance",
        subType: "whole_life",
        value: 500_000,
        basis: 0,
        growthRate: 0,
        rmdEnabled: false,
        owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
      },
    ];
    const projection = runProjection(data);
    const events = detectInsuranceEvents(data, projection);
    // Deterministic emission: at most one event per life-insurance account across the plan.
    const byAccount = new Map<string, number>();
    for (const e of events) {
      byAccount.set(e.id, (byAccount.get(e.id) ?? 0) + 1);
    }
    for (const count of byAccount.values()) expect(count).toBe(1);
  });

  it("emits a term_expired event in the year after a term policy's last in-force year", () => {
    const data = buildClientData();
    const termPolicy: LifeInsurancePolicy = {
      faceValue: 1_000_000,
      costBasis: 0,
      premiumAmount: 2400,
      premiumYears: 20,
      policyType: "term",
      termIssueYear: 2025,
      termLengthYears: 20, // in-force through 2044; expires in 2045
      endsAtInsuredRetirement: false,
      cashValueGrowthMode: "basic",
      postPayoutGrowthRate: 0.06,
      cashValueSchedule: [],
    };
    data.accounts = [
      ...data.accounts,
      {
        id: "acct-term",
        name: "20-year term on client",
        category: "life_insurance",
        subType: "term",
        insuredPerson: "client",
        value: 0,
        basis: 0,
        growthRate: 0,
        rmdEnabled: false,
        owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
        lifeInsurance: termPolicy,
      },
    ];
    const projection = runProjection(data);
    const events = detectInsuranceEvents(data, projection);
    const expired = events.filter((e) => e.id === "insurance:term_expired:acct-term");
    expect(expired).toHaveLength(1);
    expect(expired[0].year).toBe(2045);
    expect(expired[0].title).toBe("Term insurance expired");
    expect(expired[0].supportingFigure).toContain("$1,000,000");
    expect(expired[0].details).toEqual(
      expect.arrayContaining([{ label: "Term end year", value: "2044" }]),
    );
  });
});
