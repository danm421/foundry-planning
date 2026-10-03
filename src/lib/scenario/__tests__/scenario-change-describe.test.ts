import { describe, it, expect } from "vitest";
import {
  describeChangeUnit,
  describeEditFields,
  describeLifeInsuranceDiff,
  type ChangeUnit,
} from "../scenario-change-describe";

const targetNames: Record<string, string> = {
  "income:i1": "Cooper's Salary",
  "expense:e1": "Travel",
  "asset_transaction:at-1": "Move house — Sell Oak",
};

describe("describeChangeUnit — single ops", () => {
  it("describes add", () => {
    const unit: ChangeUnit = {
      kind: "single",
      change: { id: "c1", scenarioId: "s1", opType: "add", targetKind: "income", targetId: "i1", payload: {}, toggleGroupId: null, orderIndex: 0, enabled: true },
    };
    expect(describeChangeUnit(unit, targetNames)).toBe("Added: Cooper's Salary.");
  });

  it("names an add the names map misses by its payload's stored name, never the raw id", () => {
    // A switched-off stress test is absent from the tree the names map is
    // built from, and Forge previews pass no map at all.
    const unit: ChangeUnit = {
      kind: "single",
      change: {
        id: "c9", scenarioId: "s1", opType: "add", targetKind: "stress_test", targetId: "f06746bf-25ea-4c3f-9430-c3c7edf1b100",
        payload: { kind: "market-crash", year: 2027, drawdownPct: 0.3, name: "Market crash — 30% in 2027" },
        toggleGroupId: null, orderIndex: 0, enabled: false,
      },
    };
    expect(describeChangeUnit(unit, {})).toBe("Added: Market crash — 30% in 2027.");
  });

  it("describes remove", () => {
    const unit: ChangeUnit = {
      kind: "single",
      change: { id: "c2", scenarioId: "s1", opType: "remove", targetKind: "expense", targetId: "e1", payload: null, toggleGroupId: null, orderIndex: 0, enabled: true },
    };
    expect(describeChangeUnit(unit, targetNames)).toBe("Removed: Travel.");
  });

  it("describes single-field edit with formatted from/to", () => {
    const unit: ChangeUnit = {
      kind: "single",
      change: {
        id: "c3", scenarioId: "s1", opType: "edit", targetKind: "income", targetId: "i1",
        payload: { endYear: { from: 2040, to: 2042 } },
        toggleGroupId: null, orderIndex: 0, enabled: true,
      },
    };
    expect(describeChangeUnit(unit, targetNames)).toBe("Changed endYear on Cooper's Salary: 2040 → 2042.");
  });

  it("describes multi-field edit", () => {
    const unit: ChangeUnit = {
      kind: "single",
      change: {
        id: "c4", scenarioId: "s1", opType: "edit", targetKind: "income", targetId: "i1",
        payload: { endYear: { from: 2040, to: 2042 }, annualAmount: { from: 100, to: 200 } },
        toggleGroupId: null, orderIndex: 0, enabled: true,
      },
    };
    expect(describeChangeUnit(unit, targetNames)).toBe("Changed 2 fields on Cooper's Salary: endYear, annualAmount.");
  });
});

describe("describeChangeUnit — groups", () => {
  it("summarizes a group with target names", () => {
    const unit: ChangeUnit = {
      kind: "group",
      groupName: "Retirement Age Push",
      changes: [
        { id: "c1", scenarioId: "s1", opType: "edit", targetKind: "income", targetId: "i1", payload: { endYear: { from: 2040, to: 2042 } }, toggleGroupId: "g1", orderIndex: 0, enabled: true },
        { id: "c2", scenarioId: "s1", opType: "edit", targetKind: "expense", targetId: "e1", payload: { startYear: { from: 2040, to: 2042 } }, toggleGroupId: "g1", orderIndex: 1, enabled: true },
      ],
    };
    expect(describeChangeUnit(unit, targetNames)).toBe("2 changes: Cooper's Salary, Travel.");
  });
});

describe("describeChangeUnit — array-valued edits", () => {
  const edit = (to: unknown[]) =>
    describeChangeUnit(
      {
        kind: "single",
        change: {
          opType: "edit",
          targetKind: "liability",
          targetId: "liab-1",
          payload: { extraPayments: { from: [], to } },
          enabled: true,
        } as never,
      },
      { "liability:liab-1": "Primary Mortgage" },
    );

  it("counts entries instead of printing [object Object]", () => {
    const text = edit([{ id: "a" }, { id: "b" }, { id: "c" }]);
    expect(text).toBe("Changed extraPayments on Primary Mortgage: none → 3 entries.");
    expect(text).not.toContain("[object Object]");
  });

  it("uses the singular for one entry", () => {
    expect(edit([{ id: "a" }])).toContain("→ 1 entry");
  });
});

describe("describeChangeUnit — internal fields", () => {
  // `bundleId` links the legs of one dialog save. It rides the change payload
  // on purpose (promote needs it), but this line renders in the in-app panel,
  // in the Forge preview and in the retirement-comparison AI prompt — a raw
  // uuid belongs in none of them.
  const BUNDLE_UUID = "7f3a91c2-0000-4000-8000-0000000000ab";
  const txnEdit = (payload: Record<string, { from: unknown; to: unknown }>) =>
    describeChangeUnit(
      {
        kind: "single",
        change: {
          id: "c5", scenarioId: "s1", opType: "edit", targetKind: "asset_transaction",
          targetId: "at-1", payload, toggleGroupId: null, orderIndex: 0, enabled: true,
        },
      },
      targetNames,
    );

  it("a bundleId-only edit prints no uuid and falls back to the plain edit line", () => {
    const text = txnEdit({ bundleId: { from: null, to: BUNDLE_UUID } });
    expect(text).toBe("Edited: Move house — Sell Oak.");
    expect(text).not.toContain(BUNDLE_UUID);
  });

  it("a {name, bundleId} edit reports ONE field and never names bundleId", () => {
    const text = txnEdit({
      name: { from: "Sell Oak", to: "Move house — Sell Oak" },
      bundleId: { from: null, to: BUNDLE_UUID },
    });
    expect(text).toBe("Changed name on Move house — Sell Oak: Sell Oak → Move house — Sell Oak.");
    expect(text).not.toContain("2 fields");
    expect(text).not.toContain("bundleId");
    expect(text).not.toContain(BUNDLE_UUID);
  });

  it("hides the field for asset transactions only, never every kind", () => {
    // No other kind owns a bundleId today; this pins that the suppression is
    // keyed on targetKind, so adding one does not silently swallow its value.
    const text = describeChangeUnit(
      {
        kind: "single",
        change: {
          id: "c6", scenarioId: "s1", opType: "edit", targetKind: "income", targetId: "i1",
          payload: { bundleId: { from: null, to: BUNDLE_UUID } },
          toggleGroupId: null, orderIndex: 0, enabled: true,
        },
      },
      targetNames,
    );
    expect(text).toContain("bundleId");
  });
});

describe("describeChangeUnit — growth & inflation settings", () => {
  const settingsEdit = (payload: Record<string, { from: unknown; to: unknown }>) =>
    describeChangeUnit(
      {
        kind: "single",
        change: {
          id: "c6", scenarioId: "s1", opType: "edit", targetKind: "plan_settings",
          targetId: "client-1", payload, toggleGroupId: null, orderIndex: 0, enabled: true,
        },
      },
      { "plan_settings:client-1": "Plan settings" },
    );

  it("labels a default-growth key and formats the rate as a percent", () => {
    expect(settingsEdit({ defaultGrowthTaxable: { from: 0.06, to: 0.07 } })).toBe(
      "Changed Default growth — taxable on Plan settings: 6% → 7%.",
    );
  });

  it("labels the inflation rate and source", () => {
    expect(settingsEdit({ inflationRate: { from: 0.025, to: 0.03 } })).toContain("Inflation rate");
    expect(settingsEdit({ inflationRate: { from: 0.025, to: 0.03 } })).toContain("2.5% → 3%");
    expect(settingsEdit({ inflationRateSource: { from: "asset_class", to: "custom" } })).toContain(
      "Inflation source on Plan settings: Asset class → Custom",
    );
  });

  it("names the labelled fields of a multi-field edit", () => {
    expect(
      settingsEdit({
        growthSourceCash: { from: "custom", to: "inflation" },
        medicarePremiumInflationRate: { from: 0.03, to: 0.04 },
      }),
    ).toBe(
      "Changed 2 fields on Plan settings: Growth source — cash, Medicare premium inflation rate.",
    );
  });

  it("does not print a model-portfolio uuid", () => {
    const uuid = "7f3a91c2-0000-4000-8000-0000000000ab";
    const text = settingsEdit({ modelPortfolioIdTaxable: { from: null, to: uuid } });
    expect(text).toContain("Model portfolio — taxable");
    expect(text).toContain("none → a model portfolio");
    expect(text).not.toContain(uuid);
  });

  it("leaves a key it has no label for as the raw key", () => {
    expect(settingsEdit({ flatFederalRate: { from: 0.22, to: 0.24 } })).toContain("flatFederalRate");
  });

  it("prints a toggle as On / Off", () => {
    expect(settingsEdit({ medicarePremiumInflationEnabled: { from: true, to: false } })).toContain("On → Off");
  });
});

describe("describeLifeInsuranceDiff", () => {
  const base = { policyType: "term", faceValue: 500000, premiumAmount: 900, costBasis: 0, cashValueSchedule: [] };

  it("names the headline changes", () => {
    expect(describeLifeInsuranceDiff(base, { ...base, faceValue: 750000, premiumAmount: 1200 })).toBe(
      "Policy: face value $500,000 → $750,000 · premium $900 → $1,200",
    );
  });

  it("falls back to 'other terms' when only a secondary field moved", () => {
    expect(describeLifeInsuranceDiff(base, { ...base, cashValueSchedule: [{ year: 2027, cashValue: 1 }] })).toBe(
      "Policy: other terms changed",
    );
  });

  it("reads a policy added to or cleared from the account", () => {
    expect(describeLifeInsuranceDiff(undefined, base)).toBe("Policy: added (Term, $500,000 face value)");
    expect(describeLifeInsuranceDiff(base, null)).toBe("Policy: removed");
  });

  it("an edit unit on one policy field reads humanely, not [object Object]", () => {
    const unit: ChangeUnit = {
      kind: "single",
      change: {
        id: "c1",
        scenarioId: "s",
        opType: "edit",
        targetKind: "account",
        targetId: "acct-1",
        payload: { lifeInsurance: { from: base, to: { ...base, faceValue: 600000 } } },
        toggleGroupId: null,
        orderIndex: 0,
        enabled: true,
      },
    };
    expect(describeChangeUnit(unit, { "account:acct-1": "Whole Life" })).toBe(
      "Changed policy terms on Whole Life: face value $500,000 → $600,000.",
    );
  });
});

describe("describeEditFields — the Changes panel's edit line", () => {
  const MP = "a920a13c-9a13-4850-b957-6aa9c1ca1fa9";

  it("names the field in words and formats the amounts", () => {
    expect(describeEditFields("expense", { annualAmount: { from: 113440, to: 113400 } })).toBe(
      "Annual amount: $113,440 → $113,400",
    );
  });

  it("reads a number the overlay stored as a string", () => {
    expect(describeEditFields("income", { annualAmount: { from: "250000", to: "261000" } })).toBe(
      "Annual amount: $250,000 → $261,000",
    );
  });

  it("joins several fields, keeps years plain and prints rates as percents", () => {
    expect(
      describeEditFields("liability", {
        startYear: { from: 2026, to: 2028 },
        interestRate: { from: 0.04, to: "0.105" },
      }),
    ).toBe("Start year: 2026 → 2028 · Interest rate: 4% → 10.5%");
  });

  it("prints a blank side and a toggle in words", () => {
    expect(describeEditFields("account", { rothRolloverEnabled: { to: false } })).toBe(
      "Roth rollover enabled: — → No",
    );
  });

  it("names an id- or object-valued field without printing it", () => {
    const owners = (id: string) => [{ kind: "family_member", familyMemberId: id, percent: 1 }];
    const text = describeEditFields("account", {
      owners: { from: owners("11111111-2222-3333-4444-555555555555"), to: owners(MP) },
      linkedPropertyId: { from: null, to: MP },
    });
    expect(text).toBe("Owners changed · Linked property id changed");
    expect(text).not.toMatch(/[0-9a-f]{8}-/);
  });

  it("drops internal plumbing fields", () => {
    expect(
      describeEditFields("asset_transaction", { bundleId: { from: null, to: MP }, name: { from: "Sell", to: "Sell Oak" } }),
    ).toBe("Name: Sell → Sell Oak");
  });

  it("keeps the growth-settings vocabulary", () => {
    expect(
      describeEditFields("plan_settings", {
        inflationRate: { from: 0.025, to: 0.03 },
        modelPortfolioIdTaxable: { from: MP, to: "fdeb2131-a265-4e45-b4a8-1c81341a1fa1" },
      }),
    ).toBe("Inflation rate: 2.5% → 3% · Model portfolio — taxable changed");
  });

  it("describes a life-policy edit by its headline terms", () => {
    const base = { policyType: "term", faceValue: 500000, premiumAmount: 900 };
    expect(describeEditFields("account", { lifeInsurance: { from: base, to: { ...base, faceValue: 600000 } } })).toBe(
      "Policy: face value $500,000 → $600,000",
    );
  });

  it("names the household's second person by role, never the stored token", () => {
    expect(describeEditFields("income", { owner: { from: "client", to: "spouse" } })).not.toMatch(/spouse/);
  });
});
