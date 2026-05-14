import { describe, expect, it } from "vitest";
import { renderToTree } from "@/components/pdf/test-utils/render-tree";
import { ScenarioChangesPdf } from "../scenario-changes";

const branding = { primaryColor: "#0066cc", firmName: "x", logoDataUrl: null };

/** Minimal ScenarioChange for a single "add" operation */
function makeAddChange(id: string, targetKind: string, targetId: string) {
  return {
    id,
    scenarioId: "sc1",
    opType: "add" as const,
    targetKind,
    targetId,
    payload: null,
    toggleGroupId: null,
    orderIndex: 0,
    updatedAt: new Date(),
    enabled: true,
  };
}

/** Minimal ScenarioChange for an "edit" operation with a field diff */
function makeEditChange(id: string, targetKind: string, targetId: string) {
  return {
    id,
    scenarioId: "sc1",
    opType: "edit" as const,
    targetKind,
    targetId,
    payload: { amount: { from: 40_000, to: 50_000 } },
    toggleGroupId: null,
    orderIndex: 1,
    updatedAt: new Date(),
    enabled: true,
  };
}

describe("ScenarioChangesPdf", () => {
  it("renders the plan label and change descriptions for a scenario plan", () => {
    const tree = renderToTree(
      <ScenarioChangesPdf
        config={undefined}
        plans={[
          {
            id: "sc1",
            label: "Roth conversion",
            panelData: {
              scenarioId: "sc1",
              scenarioName: "Roth conversion",
              label: "Roth conversion",
              changes: [makeAddChange("c1", "roth_conversion", "rc-001")],
              toggleGroups: [],
              cascadeWarnings: [],
              targetNames: { "roth_conversion:rc-001": "Roth Conversion $50k/yr" },
            },
          } as never,
        ]}
        mc={null}
        yearRange={null}
        span={5}
        branding={branding}
      />,
    );
    expect(tree).toContain("Roth conversion");
    expect(tree).toContain("Roth Conversion $50k/yr");
  });

  it("renders edit changes with from→to field description", () => {
    const tree = renderToTree(
      <ScenarioChangesPdf
        config={undefined}
        plans={[
          {
            id: "sc1",
            label: "Salary bump",
            panelData: {
              scenarioId: "sc1",
              scenarioName: "Salary bump",
              label: "Salary bump",
              changes: [makeEditChange("c2", "income", "inc-001")],
              toggleGroups: [],
              cascadeWarnings: [],
              targetNames: { "income:inc-001": "Software Engineer Salary" },
            },
          } as never,
        ]}
        mc={null}
        yearRange={null}
        span={5}
        branding={branding}
      />,
    );
    expect(tree).toContain("Salary bump");
    expect(tree).toContain("Software Engineer Salary");
    // describeChangeUnit renders: "Changed amount on …: $40,000 → $50,000."
    expect(tree).toContain("amount");
  });

  it("skips plans with null panelData (baseline)", () => {
    const tree = renderToTree(
      <ScenarioChangesPdf
        config={undefined}
        plans={[
          { id: "base", label: "Base case", panelData: null } as never,
          {
            id: "sc1",
            label: "Aggressive",
            panelData: {
              scenarioId: "sc1",
              scenarioName: "Aggressive",
              label: "Aggressive",
              changes: [makeAddChange("c3", "income", "inc-999")],
              toggleGroups: [],
              cascadeWarnings: [],
              targetNames: { "income:inc-999": "New job income" },
            },
          } as never,
        ]}
        mc={null}
        yearRange={null}
        span={5}
        branding={branding}
      />,
    );
    expect(tree).toContain("Aggressive");
    expect(tree).toContain("New job income");
    expect(tree).not.toContain("Base case");
  });

  it("renders a group-kind ChangeUnit when toggleGroups are present", () => {
    const groupedChange = {
      ...makeAddChange("c4", "income", "inc-555"),
      toggleGroupId: "grp1",
    };
    const tree = renderToTree(
      <ScenarioChangesPdf
        config={undefined}
        plans={[
          {
            id: "sc1",
            label: "Group plan",
            panelData: {
              scenarioId: "sc1",
              scenarioName: "Group plan",
              label: "Group plan",
              changes: [groupedChange],
              toggleGroups: [{ id: "grp1", scenarioId: "sc1", name: "Dual income boost" }],
              cascadeWarnings: [],
              targetNames: { "income:inc-555": "Side hustle" },
            },
          } as never,
        ]}
        mc={null}
        yearRange={null}
        span={5}
        branding={branding}
      />,
    );
    expect(tree).toContain("Group plan");
    // Group unit uses groupName as title
    expect(tree).toContain("Dual income boost");
  });
});
