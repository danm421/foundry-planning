// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ScenarioChangesComparisonSection } from "../scenario-changes-comparison-section";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";

global.fetch = vi.fn();

function mkPlan(label: string, panelData: ComparisonPlan["panelData"]): ComparisonPlan {
  return {
    index: 0,
    isBaseline: false,
    ref: { kind: "scenario", id: label },
    id: label,
    label,
    tree: {} as ComparisonPlan["tree"],
    result: { years: [] } as ComparisonPlan["result"],
    lifetime: {} as ComparisonPlan["lifetime"],
    liquidityRows: [],
    finalEstate: null,
    panelData,
    allocation: null,
  };
}

describe("ScenarioChangesComparisonSection", () => {
  it("renders 'No changes' for a base plan", () => {
    render(<ScenarioChangesComparisonSection plans={[mkPlan("Base", null)]} clientId="c1" />);
    expect(screen.getByText(/No changes/i)).toBeTruthy();
  });

  it("renders one box per ungrouped change and one per toggle group", () => {
    const panel: NonNullable<ComparisonPlan["panelData"]> = {
      scenarioId: "s1",
      scenarioName: "Push Retirement",
      label: "Push Retirement",
      changes: [
        { id: "c1", scenarioId: "s1", opType: "edit", targetKind: "income", targetId: "i1", payload: { endYear: { from: 2040, to: 2042 } }, toggleGroupId: null, orderIndex: 0, enabled: true, updatedAt: new Date() },
        { id: "c2", scenarioId: "s1", opType: "edit", targetKind: "income", targetId: "i2", payload: { endYear: { from: 2040, to: 2042 } }, toggleGroupId: "g1", orderIndex: 0, enabled: true, updatedAt: new Date() },
      ],
      toggleGroups: [{ id: "g1", scenarioId: "s1", name: "Spouse Push", defaultOn: true, requiresGroupId: null, orderIndex: 0 } as unknown as NonNullable<ComparisonPlan["panelData"]>["toggleGroups"][number]],
      cascadeWarnings: [],
      targetNames: { "income:i1": "Cooper's Salary", "income:i2": "Susan's Salary" },
    };
    render(<ScenarioChangesComparisonSection plans={[mkPlan("Push Retirement", panel)]} clientId="c1" />);
    expect(screen.getByText("Cooper's Salary")).toBeTruthy();   // Ungrouped box title
    expect(screen.getByText("Spouse Push")).toBeTruthy();        // Group box title
  });
});
