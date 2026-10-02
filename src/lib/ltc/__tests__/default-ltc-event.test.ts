import { describe, it, expect } from "vitest";
import { defaultLtcEvent } from "../default-ltc-event";
import { buildClientData, baseClient, basePlanSettings } from "@/engine/__tests__/fixtures";

describe("defaultLtcEvent", () => {
  it("client in a private nursing room at 85 for 3 years, cut off, no sale", () => {
    const e = defaultLtcEvent(buildClientData());
    expect(e.people).toEqual([
      { person: "client", startAge: 85, years: 3, careSetting: "nursing_private", annualCost: 129_575, costInflation: 0.05 },
    ]);
    expect(e.livingExpenseCutPct).toBeNull();
    expect(e.homeSale).toBeNull();
    expect(e.includePolicies).toBe(true);
    expect(e.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(e.name).toBe("Long-term care — John 85–87");
  });

  it("starts care this year for a client already past 85", () => {
    const old = buildClientData({ client: { ...baseClient, dateOfBirth: "1938-03-01" }, planSettings: basePlanSettings });
    expect(defaultLtcEvent(old).people[0].startAge).toBe(2026 - 1938); // 88
  });
});
