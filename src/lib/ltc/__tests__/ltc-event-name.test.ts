import { describe, it, expect } from "vitest";
import { ltcEventName, ltcPersonFirstName } from "../ltc-event-name";
import { baseClient } from "@/engine/__tests__/fixtures";
import { CO_CLIENT_LABEL } from "@/lib/owner-labels";

const person = (over: Partial<import("@/engine/types").LtcCarePerson> = {}) => ({
  person: "client" as const,
  startAge: 85,
  years: 3,
  careSetting: "nursing_private" as const,
  annualCost: 129_575,
  costInflation: 0.05,
  ...over,
});

describe("ltcEventName", () => {
  it("names one person's care span", () => {
    expect(
      ltcEventName(
        { id: "x", people: [person()], livingExpenseCutPct: null, homeSale: null, includePolicies: true },
        baseClient,
      ),
    ).toBe("Long-term care — John 85–87");
  });

  it("names both people and the home sale; a one-year span is a single age", () => {
    expect(
      ltcEventName(
        {
          id: "x",
          people: [person(), person({ person: "spouse", startAge: 88, years: 1 })],
          livingExpenseCutPct: 1,
          homeSale: { accountId: "acct-home", saleYear: 2055, price: { mode: "projected" }, sellingCostPct: 0.06 },
          includePolicies: true,
        },
        baseClient,
      ),
    ).toBe("Long-term care — John 85–87, Jane 88 · home sold 2055");
  });
});

describe("ltcPersonFirstName", () => {
  it("falls back to the shared co-client label when the spouse has no name", () => {
    expect(ltcPersonFirstName("spouse", { ...baseClient, spouseName: undefined })).toBe(CO_CLIENT_LABEL);
    expect(ltcPersonFirstName("spouse", { ...baseClient, spouseName: "  " })).toBe(CO_CLIENT_LABEL);
  });
});
