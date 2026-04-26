// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import {
  ScenarioPickerDropdown,
  type ScenarioOption,
  type SnapshotOption,
} from "../scenario-picker-dropdown";

const SCENARIOS: ScenarioOption[] = [
  { id: "base", name: "Base case", isBaseCase: true },
  { id: "s1", name: "Roth conversion", isBaseCase: false },
  { id: "s2", name: "Early retirement", isBaseCase: false },
];

const SNAPSHOTS: SnapshotOption[] = [
  { id: "snap-m1", name: "Manual A", sourceKind: "manual" },
  { id: "snap-m2", name: "Manual B", sourceKind: "manual" },
  { id: "snap-p1", name: "PDF export 2026-01-01", sourceKind: "pdf_export" },
];

function getOptionValues(label: string): string[] {
  const group = screen.getByRole("group", { name: label }) as HTMLOptGroupElement;
  return Array.from(group.querySelectorAll("option")).map((o) => o.value);
}

describe("ScenarioPickerDropdown", () => {
  it("renders the Base case option always", () => {
    render(
      <ScenarioPickerDropdown
        value="base"
        onChange={() => {}}
        scenarios={[]}
        snapshots={[]}
      />,
    );
    const baseOption = screen.getByRole("option", {
      name: "Base case",
    }) as HTMLOptionElement;
    expect(baseOption.value).toBe("base");
  });

  it("renders a Scenarios optgroup with non-base scenarios only", () => {
    render(
      <ScenarioPickerDropdown
        value="base"
        onChange={() => {}}
        scenarios={SCENARIOS}
        snapshots={[]}
      />,
    );
    const values = getOptionValues("Scenarios");
    expect(values).toEqual(["s1", "s2"]);
    expect(values).not.toContain("base");
  });

  it("renders Snapshots optgroups grouped by sourceKind and prefixes value with snap:", () => {
    render(
      <ScenarioPickerDropdown
        value="base"
        onChange={() => {}}
        scenarios={[]}
        snapshots={SNAPSHOTS}
      />,
    );
    expect(getOptionValues("Snapshots — Manual")).toEqual([
      "snap:snap-m1",
      "snap:snap-m2",
    ]);
    expect(getOptionValues("Snapshots — PDF exports")).toEqual([
      "snap:snap-p1",
    ]);
  });

  it("calls onChange with the selected option's value", () => {
    const onChange = vi.fn();
    render(
      <ScenarioPickerDropdown
        value="base"
        onChange={onChange}
        scenarios={SCENARIOS}
        snapshots={SNAPSHOTS}
        ariaLabel="Right scenario"
      />,
    );
    const select = screen.getByRole("combobox", {
      name: "Right scenario",
    }) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "snap:snap-m1" } });
    expect(onChange).toHaveBeenCalledWith("snap:snap-m1");
  });

  it("omits empty Snapshots optgroups when no snapshots of that kind exist", () => {
    render(
      <ScenarioPickerDropdown
        value="base"
        onChange={() => {}}
        scenarios={[]}
        snapshots={[
          { id: "snap-m1", name: "Manual A", sourceKind: "manual" },
        ]}
      />,
    );
    expect(
      screen.queryByRole("group", { name: "Snapshots — Manual" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("group", { name: "Snapshots — PDF exports" }),
    ).toBeNull();
  });
});
