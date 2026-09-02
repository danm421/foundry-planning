// @vitest-environment jsdom
import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { ScenarioComparisonOptionsControl } from "./options-control";
import { PresentationOptionsProvider } from "@/components/presentations/options-context";
import { EMPTY_INVESTMENT_OPTION_CATALOG } from "@/lib/presentations/investment-option-catalog";
import { SCENARIO_COMPARISON_OPTIONS_DEFAULT } from "@/lib/presentations/pages/scenario-comparison/options-schema";
import type { ScenarioComparisonOptions } from "@/lib/presentations/pages/scenario-comparison/types";
import type { ScenarioOption } from "@/components/scenario/scenario-picker-dropdown";

const SCENARIOS: ScenarioOption[] = [
  { id: "base", name: "Base Case", isBaseCase: true },
  { id: "s1", name: "Growth Scenario", isBaseCase: false },
  { id: "s2", name: "Conservative Scenario", isBaseCase: false },
  { id: "s3", name: "Early Retirement", isBaseCase: false },
  // Nothing in this app ever produces an id shaped like this — `snap:` ids
  // live only in SnapshotOption, a wholly separate type from ScenarioOption
  // — but the row filter guards for it defensively anyway. This entry proves
  // that guard does something: remove `!s.id.startsWith("snap:")` from the
  // component and this row starts showing up in the picker.
  { id: "snap:abc123", name: "A Snapshot", isBaseCase: false },
];

function renderControl(
  overrides: Partial<ScenarioComparisonOptions> = {},
  onChange = vi.fn(),
  scenarios: ScenarioOption[] = SCENARIOS,
) {
  const value = { ...SCENARIO_COMPARISON_OPTIONS_DEFAULT, ...overrides };
  render(
    <PresentationOptionsProvider
      value={{ investmentCatalog: EMPTY_INVESTMENT_OPTION_CATALOG, scenarios, clientId: "c1" }}
    >
      <ScenarioComparisonOptionsControl value={value} onChange={onChange} />
    </PresentationOptionsProvider>,
  );
  return { onChange };
}

/** A stateful harness for tests that need real interaction to carry across
 *  re-renders (adding/removing rows), rather than just inspecting the args of
 *  a single onChange call. */
function ControlledHarness({
  initial,
  scenarios = SCENARIOS,
}: {
  initial: ScenarioComparisonOptions;
  scenarios?: ScenarioOption[];
}) {
  const [value, setValue] = useState(initial);
  return (
    <PresentationOptionsProvider
      value={{ investmentCatalog: EMPTY_INVESTMENT_OPTION_CATALOG, scenarios, clientId: "c1" }}
    >
      <ScenarioComparisonOptionsControl value={value} onChange={setValue} />
    </PresentationOptionsProvider>
  );
}

function optionNames(select: HTMLElement): string[] {
  return within(select)
    .getAllByRole("option")
    .map((o) => o.textContent);
}

describe("ScenarioComparisonOptionsControl", () => {
  it("labels the max-spend switch with its cost and explains the missing length control", () => {
    renderControl();
    expect(
      screen.getByText("Solves each column's sustainable spending. Adds time to the first export."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Length is set by the number of scenarios so the report always fits two pages."),
    ).toBeInTheDocument();
  });

  it("lists only live scenarios — never Base Case, never a snapshot", () => {
    renderControl({ scenarioIds: ["s1"] });
    const names = optionNames(screen.getByLabelText("Scenario 1"));
    expect(names).toEqual(["— Select a scenario —", "Growth Scenario", "Conservative Scenario", "Early Retirement"]);
    expect(names).not.toContain("Base Case");
    expect(names).not.toContain("A Snapshot");
  });

  it("adds a scenario row and disables Add at three", () => {
    render(<ControlledHarness initial={{ ...SCENARIO_COMPARISON_OPTIONS_DEFAULT, scenarioIds: [] }} />);
    const addButton = screen.getByRole("button", { name: "Add scenario" });
    expect(screen.queryByLabelText("Scenario 1")).not.toBeInTheDocument();

    fireEvent.click(addButton);
    expect(screen.getByLabelText("Scenario 1")).toBeInTheDocument();
    expect(addButton).not.toBeDisabled();

    fireEvent.click(addButton);
    fireEvent.click(addButton);
    expect(screen.getByLabelText("Scenario 1")).toBeInTheDocument();
    expect(screen.getByLabelText("Scenario 2")).toBeInTheDocument();
    expect(screen.getByLabelText("Scenario 3")).toBeInTheDocument();
    expect(addButton).toBeDisabled();
  });

  it("omits an already-chosen scenario from the other selects", () => {
    renderControl({ scenarioIds: ["s1", "s2"] });
    const row1 = optionNames(screen.getByLabelText("Scenario 1"));
    const row2 = optionNames(screen.getByLabelText("Scenario 2"));

    // Row 1 keeps its own selection (s1) plus whatever's still free (s3), but
    // not s2 — that's row 2's pick.
    expect(row1).toEqual(["— Select a scenario —", "Growth Scenario", "Early Retirement"]);
    // Row 2 keeps its own selection (s2) plus s3, but not s1.
    expect(row2).toEqual(["— Select a scenario —", "Conservative Scenario", "Early Retirement"]);
  });

  it("removes a row and drops its id from scenarioIds", () => {
    const { onChange } = renderControl({ scenarioIds: ["s1", "s2"] });
    fireEvent.click(screen.getByRole("button", { name: "Remove scenario 1" }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ scenarioIds: ["s2"] }),
    );
  });

  it("preserves the order the advisor chose", () => {
    renderControl({ scenarioIds: ["s2", "s1"] });
    expect((screen.getByLabelText("Scenario 1") as HTMLSelectElement).value).toBe("s2");
    expect((screen.getByLabelText("Scenario 2") as HTMLSelectElement).value).toBe("s1");
  });

  it("shows Base Case as a fixed, non-removable first column", () => {
    renderControl({ scenarioIds: ["s1"] });
    expect(screen.getByText("Base Case")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /remove.*base/i })).not.toBeInTheDocument();

    // Base Case is column 1 — it must render before the first scenario row.
    const group = screen.getByText("Base Case").closest("div")?.parentElement;
    expect(group).not.toBeNull();
    const baseIndex = Array.from(group!.children).findIndex((el) => el.textContent?.includes("Base Case"));
    const scenario1Index = Array.from(group!.children).findIndex((el) =>
      el.contains(screen.getByLabelText("Scenario 1")),
    );
    expect(baseIndex).toBeLessThan(scenario1Index);
  });

  // Task 11 extra: fresh-mount tests never call a hook twice, so they can't
  // catch a conditional `return` placed before one (the exact shape that
  // crashed the Solver previously). This rerenders the SAME component
  // instance across a real state boundary — zero scenario rows to one — and
  // proves it survives without violating rules-of-hooks or losing the
  // exclusion-list derivation.
  it("survives a rerender from zero scenario rows to one without violating hook order", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <PresentationOptionsProvider
        value={{ investmentCatalog: EMPTY_INVESTMENT_OPTION_CATALOG, scenarios: SCENARIOS, clientId: "c1" }}
      >
        <ScenarioComparisonOptionsControl
          value={{ ...SCENARIO_COMPARISON_OPTIONS_DEFAULT, scenarioIds: [] }}
          onChange={onChange}
        />
      </PresentationOptionsProvider>,
    );
    expect(screen.queryByLabelText("Scenario 1")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add scenario" })).not.toBeDisabled();

    rerender(
      <PresentationOptionsProvider
        value={{ investmentCatalog: EMPTY_INVESTMENT_OPTION_CATALOG, scenarios: SCENARIOS, clientId: "c1" }}
      >
        <ScenarioComparisonOptionsControl
          value={{ ...SCENARIO_COMPARISON_OPTIONS_DEFAULT, scenarioIds: ["s1"] }}
          onChange={onChange}
        />
      </PresentationOptionsProvider>,
    );

    const row1 = screen.getByLabelText("Scenario 1") as HTMLSelectElement;
    expect(row1.value).toBe("s1");
    // The newly-visible row's own exclusion derivation still runs correctly
    // post-rerender: s2/s3 remain offered, s1 (this row's own pick) still
    // appears too.
    expect(optionNames(row1)).toEqual([
      "— Select a scenario —",
      "Growth Scenario",
      "Conservative Scenario",
      "Early Retirement",
    ]);
  });
});
