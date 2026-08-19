import { describe, it, expect } from "vitest";
import { buildScenarioChangesData } from "../view-model";
import { readFile } from "node:fs/promises";
import { PRESENTATION_PAGES } from "@/components/presentations/registry";
import { SCENARIO_CHANGES_OPTIONS_DEFAULT } from "../options-schema";
import type { ScenarioChange } from "@/engine/scenario/types";

function ch(p: Partial<ScenarioChange>): ScenarioChange {
  return { id: "c", scenarioId: "s", opType: "edit", targetKind: "income", targetId: "i1",
    payload: {}, toggleGroupId: null, orderIndex: 0, ...p };
}

describe("scenario-changes naming", () => {
  // The report is client-facing: "Scenario" is our internal word, not the
  // advisor's. Pin the printed heading and the sheet's eyebrow together so a
  // future edit can't rename one and leave the other contradicting it.
  it("prints as Plan Comparison on the sheet heading and the eyebrow", async () => {
    expect(SCENARIO_CHANGES_OPTIONS_DEFAULT.title).toBe("Plan Comparison");
    const src = await readFile(
      new URL("../../../../../components/presentations/pages/scenario-changes/page-pdf.tsx", import.meta.url),
      "utf8",
    );
    expect(src).toContain('eyebrow="PLAN COMPARISON"');
  });

  it("keeps the pageId stable so saved decks still resolve the report", () => {
    expect(PRESENTATION_PAGES.scenarioChanges.id).toBe("scenarioChanges");
    expect(PRESENTATION_PAGES.scenarioChanges.title).toBe("Plan Comparison");
  });
});

describe("buildScenarioChangesData", () => {
  it("returns the empty state when no context is injected", () => {
    const data = buildScenarioChangesData(undefined, SCENARIO_CHANGES_OPTIONS_DEFAULT);
    expect(data.isEmpty).toBe(true);
    expect(data.units).toEqual([]);
  });

  it("passes showExplanations through to page data", () => {
    const withDetails = buildScenarioChangesData(undefined, { ...SCENARIO_CHANGES_OPTIONS_DEFAULT, showExplanations: true });
    expect(withDetails.showExplanations).toBe(true);
    const withoutDetails = buildScenarioChangesData(undefined, { ...SCENARIO_CHANGES_OPTIONS_DEFAULT, showExplanations: false });
    expect(withoutDetails.showExplanations).toBe(false);
  });

  it("returns the empty state when the scenario has no changes", () => {
    const data = buildScenarioChangesData(
      { changes: [], toggleGroups: [], targetNames: {}, baseLabel: "your current plan" },
      SCENARIO_CHANGES_OPTIONS_DEFAULT,
    );
    expect(data.isEmpty).toBe(true);
  });

  it("describes and groups changes", () => {
    const data = buildScenarioChangesData(
      {
        changes: [
          ch({ id: "a", targetKind: "income", targetId: "i1", opType: "add", payload: {}, orderIndex: 1 }),
          ch({ id: "b", targetKind: "entity", targetId: "e1", opType: "add", payload: {}, toggleGroupId: "g1", orderIndex: 2 }),
        ],
        toggleGroups: [{ id: "g1", scenarioId: "s", name: "IDGT sale", defaultOn: true, requiresGroupId: null, orderIndex: 0 }],
        targetNames: { "income:i1": "Rental income", "entity:e1": "IDGT" },
        baseLabel: "your current plan",
      },
      SCENARIO_CHANGES_OPTIONS_DEFAULT,
    );
    expect(data.isEmpty).toBe(false);
    expect(data.subtitle).toBe("What's different from your current plan");
    expect(data.units.some((u) => u.kind === "group" && u.label === "IDGT sale")).toBe(true);
  });
});
