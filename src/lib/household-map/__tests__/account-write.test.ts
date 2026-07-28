import { describe, it, expect } from "vitest";
import {
  buildBasePayload,
  buildScenarioDesiredFields,
  patchFromGrowthSelection,
} from "../account-write";
import type { AccountRow } from "@/components/balance-sheet-view";

function row(overrides: Partial<AccountRow> = {}): AccountRow {
  return {
    id: "acct-1",
    name: "IRA",
    category: "retirement",
    subType: "traditional_ira",
    owner: "client",
    value: "400000",
    basis: "0",
    growthRate: "0.062",
    growthSource: "model_portfolio",
    modelPortfolioId: "mp-7",
    tickerPortfolioId: null,
    rmdEnabled: true,
    countsTowardAum: false,
    turnoverPct: "0",
    propertyTaxGrowthSource: "custom",
    isDefaultChecking: false,
    titlingType: "jtwros",
    parentAccountId: null,
    ...overrides,
  } as AccountRow;
}

describe("buildBasePayload", () => {
  it("sends only the changed keys — the route update is truly partial", () => {
    expect(buildBasePayload({ value: "500000" })).toEqual({ value: "500000" });
  });

  it("sends all four growth keys together so a source switch clears the stale ids", () => {
    expect(
      buildBasePayload({
        growthSource: "inflation",
        modelPortfolioId: null,
        tickerPortfolioId: null,
        growthRate: null,
      }),
    ).toEqual({
      growthSource: "inflation",
      modelPortfolioId: null,
      tickerPortfolioId: null,
      growthRate: null,
    });
  });
});

describe("buildScenarioDesiredFields", () => {
  // THE regression this feature would otherwise ship. `applyEntityEdit` replaces
  // the change payload wholesale (changes-writer.ts:284), so any field omitted
  // here disappears from the scenario override.
  it("carries growthSource even when only the value changed", () => {
    const fields = buildScenarioDesiredFields(row(), { value: "500000" });
    expect(fields.value).toBe("500000");
    expect(fields.growthSource).toBe("model_portfolio");
    expect(fields.modelPortfolioId).toBe("mp-7");
  });

  it("carries the value even when only the growth source changed", () => {
    const fields = buildScenarioDesiredFields(row(), {
      growthSource: "inflation",
      modelPortfolioId: null,
      tickerPortfolioId: null,
      growthRate: null,
    });
    expect(fields.value).toBe("400000");
    expect(fields.growthSource).toBe("inflation");
    expect(fields.modelPortfolioId).toBeNull();
  });

  it("carries every other overridable field untouched", () => {
    const fields = buildScenarioDesiredFields(row({ rmdEnabled: false, basis: "12345" }), {
      value: "1",
    });
    expect(fields.rmdEnabled).toBe(false);
    expect(fields.basis).toBe("12345");
    expect(fields.name).toBe("IRA");
  });

  it("never sends identity or tenancy fields", () => {
    const fields = buildScenarioDesiredFields(row(), { value: "1" });
    expect(fields).not.toHaveProperty("id");
    expect(fields).not.toHaveProperty("clientId");
    expect(fields).not.toHaveProperty("linkedSource");
    expect(fields).not.toHaveProperty("beneficiaryDisplayName");
  });

  // The subtlest judgement call in this module: `owner` (singular) is the
  // DERIVED display string (client/spouse/joint) and must be stripped, while
  // `owners` (plural) is the PERSISTED ownership relation and must survive
  // untouched. The brief's base fixture never sets `owners`, so nothing above
  // proves this distinction — getting it backwards (stripping `owners` or
  // keeping `owner`) is the easiest mistake in this module and would either
  // silently drop real ownership splits or write a derived label back as data.
  it("strips the derived `owner` string but preserves the persisted `owners` array", () => {
    const owners = [
      { kind: "family_member" as const, familyMemberId: "fm-1", percent: 60 },
      { kind: "family_member" as const, familyMemberId: "fm-2", percent: 40 },
    ];
    const fields = buildScenarioDesiredFields(row({ owners }), { value: "1" });
    expect(fields).not.toHaveProperty("owner");
    expect(fields.owners).toEqual(owners);
  });
});

describe("patchFromGrowthSelection", () => {
  it("maps a model-portfolio pick to source + id, clearing the ticker id", () => {
    expect(patchFromGrowthSelection("mp:mp-9")).toEqual({
      growthSource: "model_portfolio",
      modelPortfolioId: "mp-9",
      tickerPortfolioId: null,
    });
  });

  it("maps inflation to a cleared pair", () => {
    expect(patchFromGrowthSelection("inflation")).toEqual({
      growthSource: "inflation",
      modelPortfolioId: null,
      tickerPortfolioId: null,
    });
  });

  it("does not set growthRate — custom needs the advisor to type one", () => {
    expect(patchFromGrowthSelection("custom")).not.toHaveProperty("growthRate");
  });
});
