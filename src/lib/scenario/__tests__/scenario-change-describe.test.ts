import { describe, it, expect } from "vitest";
import { describeChangeUnit, type ChangeUnit } from "../scenario-change-describe";

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
