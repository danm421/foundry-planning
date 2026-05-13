import { describe, it, expect } from "vitest";
import { describeChangeUnit, type ChangeUnit } from "../scenario-change-describe";

const targetNames: Record<string, string> = {
  "income:i1": "Cooper's Salary",
  "expense:e1": "Travel",
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
