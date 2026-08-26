import { describe, it, expect } from "vitest";
import { buildScenarioChangesData } from "../view-model";
import { readFile } from "node:fs/promises";
import { PRESENTATION_PAGES } from "@/components/presentations/registry";
import { SCENARIO_CHANGES_OPTIONS_DEFAULT } from "../options-schema";
import type { ScenarioChange } from "@/engine/scenario/types";
import type { BuildDataContext } from "@/components/presentations/registry";
import type { ScenarioChangesContext } from "../types";

const SCENARIO_ID = "11111111-1111-4111-8111-111111111111";

function ch(p: Partial<ScenarioChange>): ScenarioChange {
  return { id: "c", scenarioId: "s", opType: "edit", targetKind: "income", targetId: "i1",
    payload: {}, toggleGroupId: null, orderIndex: 0, ...p };
}

/** Minimal BuildDataContext: only `bundlesByRef` matters to this view model,
 *  and only the chosen scenario's `scenarioChanges` slot within it. */
function ctxWith(sc: ScenarioChangesContext | undefined): BuildDataContext {
  return {
    bundlesByRef: sc
      ? { [`scenario:${SCENARIO_ID}`]: { scenarioChanges: sc } }
      : {},
  } as unknown as BuildDataContext;
}

const OPTS = { ...SCENARIO_CHANGES_OPTIONS_DEFAULT, scenarioId: SCENARIO_ID };

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
  // The report needs a scenario the way Retirement / Tax Comparison do: with
  // none picked, it prints the "choose one" placeholder rather than silently
  // reporting the deck's scenario (or base) as if it had been asked for.
  it("returns the unselected empty state when no scenario is chosen", () => {
    const data = buildScenarioChangesData(
      ctxWith({ changes: [ch({})], toggleGroups: [], targetNames: {}, baseLabel: "your current plan" }),
      SCENARIO_CHANGES_OPTIONS_DEFAULT,
    );
    expect(data.isEmpty).toBe(true);
    expect(data.emptyReason).toBe("unselected");
    expect(data.units).toEqual([]);
  });

  it("returns the empty state when the chosen scenario's bundle was not loaded", () => {
    const data = buildScenarioChangesData(ctxWith(undefined), OPTS);
    expect(data.isEmpty).toBe(true);
    expect(data.emptyReason).toBe("no-changes");
  });

  it("passes showExplanations through to page data", () => {
    const withDetails = buildScenarioChangesData(ctxWith(undefined), { ...OPTS, showExplanations: true });
    expect(withDetails.showExplanations).toBe(true);
    const withoutDetails = buildScenarioChangesData(ctxWith(undefined), { ...OPTS, showExplanations: false });
    expect(withoutDetails.showExplanations).toBe(false);
  });

  it("returns the empty state when the scenario has no changes", () => {
    const data = buildScenarioChangesData(
      ctxWith({ changes: [], toggleGroups: [], targetNames: {}, baseLabel: "your current plan" }),
      OPTS,
    );
    expect(data.isEmpty).toBe(true);
    expect(data.emptyReason).toBe("no-changes");
  });

  it("describes and groups changes", () => {
    const data = buildScenarioChangesData(
      ctxWith({
        changes: [
          ch({ id: "a", targetKind: "income", targetId: "i1", opType: "add", payload: {}, orderIndex: 1 }),
          ch({ id: "b", targetKind: "entity", targetId: "e1", opType: "add", payload: {}, toggleGroupId: "g1", orderIndex: 2 }),
        ],
        toggleGroups: [{ id: "g1", scenarioId: "s", name: "IDGT sale", defaultOn: true, requiresGroupId: null, orderIndex: 0 }],
        targetNames: { "income:i1": "Rental income", "entity:e1": "IDGT" },
        baseLabel: "your current plan",
      }),
      OPTS,
    );
    expect(data.isEmpty).toBe(false);
    expect(data.subtitle).toBe("What's different from your current plan");
    expect(data.units.some((u) => u.kind === "group" && u.label === "IDGT sale")).toBe(true);
  });

  // Two scenarios in one deck: the page must read the bundle its OWN options
  // name, not whichever one happens to sit first in the map.
  it("reads the bundle named by its own scenarioId, not another loaded one", () => {
    const other = "22222222-2222-4222-8222-222222222222";
    const ctx = {
      bundlesByRef: {
        [`scenario:${other}`]: {
          scenarioChanges: {
            changes: [ch({ id: "x", targetKind: "income", targetId: "i9", opType: "add", payload: {} })],
            toggleGroups: [],
            targetNames: { "income:i9": "Wrong scenario" },
            baseLabel: "the other plan",
          },
        },
      },
    } as unknown as BuildDataContext;
    const data = buildScenarioChangesData(ctx, OPTS);
    expect(data.isEmpty).toBe(true);
    expect(data.emptyReason).toBe("no-changes");
  });
});
