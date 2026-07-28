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
    // linkedSource and beneficiaryDisplayName must be POPULATED here — the
    // base row() fixture never sets them, so asserting their absence against
    // an unset field is vacuous (it would pass even if NON_WRITABLE_KEYS were
    // reduced to just {"id"}). See the mutation check recorded in the task
    // report for this file.
    const fields = buildScenarioDesiredFields(
      row({ linkedSource: "plaid", beneficiaryDisplayName: "Ava Cooper" }),
      { value: "1" },
    );
    expect(fields).not.toHaveProperty("id");
    expect(fields).not.toHaveProperty("linkedSource");
    expect(fields).not.toHaveProperty("beneficiaryDisplayName");
    // `AccountRow` declares no `clientId` field at all today, so this
    // assertion cannot fail by construction — it is a deliberate
    // future-proofing canary, not dead weight. If someone later adds
    // `clientId` to `AccountRow`, this line starts exercising it for real and
    // forces a decision about whether it may ever be written back.
    expect(fields).not.toHaveProperty("clientId");
  });

  it("emits exactly the writable field set for a fully-populated row — a future field silently going missing fails this instead of shipping quietly", () => {
    const fullyPopulatedRow: AccountRow = {
      id: "acct-1",
      name: "IRA",
      category: "retirement",
      subType: "traditional_ira",
      owner: "client",
      value: "400000",
      basis: "0",
      linkedSource: "plaid",
      rothValue: "0",
      hsaCoverage: null,
      growthRate: "0.062",
      rmdEnabled: true,
      countsTowardAum: false,
      priorYearEndValue: "390000",
      ownerEntityId: null,
      growthSource: "model_portfolio",
      modelPortfolioId: "mp-7",
      tickerPortfolioId: null,
      turnoverPct: "0",
      overridePctOi: null,
      overridePctLtCg: null,
      overridePctQdiv: null,
      overridePctTaxExempt: null,
      annualPropertyTax: null,
      propertyTaxGrowthRate: null,
      propertyTaxGrowthSource: "custom",
      isDefaultChecking: false,
      owners: [{ kind: "family_member", familyMemberId: "fm-1", percent: 100 }],
      titlingType: "jtwros",
      parentAccountId: null,
      grantorFamilyMemberId: null,
      grantorName: null,
      beneficiaryFamilyMemberId: null,
      beneficiaryName: null,
      rothRolloverEnabled: false,
      rothRolloverStartYear: null,
      rothRolloverAccountId: null,
      beneficiaryDisplayName: "Ava Cooper",
    };

    const fields = buildScenarioDesiredFields(fullyPopulatedRow, { value: "1" });

    expect(Object.keys(fields).sort()).toEqual(
      [
        "name",
        "category",
        "subType",
        "value",
        "basis",
        "rothValue",
        "hsaCoverage",
        "growthRate",
        "rmdEnabled",
        "countsTowardAum",
        "priorYearEndValue",
        "ownerEntityId",
        "growthSource",
        "modelPortfolioId",
        "tickerPortfolioId",
        "turnoverPct",
        "overridePctOi",
        "overridePctLtCg",
        "overridePctQdiv",
        "overridePctTaxExempt",
        "annualPropertyTax",
        "propertyTaxGrowthRate",
        "propertyTaxGrowthSource",
        "isDefaultChecking",
        "owners",
        "titlingType",
        "parentAccountId",
        "grantorFamilyMemberId",
        "grantorName",
        "beneficiaryFamilyMemberId",
        "beneficiaryName",
        "rothRolloverEnabled",
        "rothRolloverStartYear",
        "rothRolloverAccountId",
      ].sort(),
    );
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
