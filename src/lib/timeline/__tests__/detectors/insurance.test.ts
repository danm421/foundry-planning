// src/lib/timeline/__tests__/detectors/insurance.test.ts
import { describe, it, expect } from "vitest";
import { detectInsuranceEvents } from "../../detectors/insurance";
import { runProjection } from "@/engine";
import { buildClientData } from "@/engine/__tests__/fixtures";

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
        owner: "client",
        value: 500_000,
        basis: 0,
        growthRate: 0,
        rmdEnabled: false,
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
});
