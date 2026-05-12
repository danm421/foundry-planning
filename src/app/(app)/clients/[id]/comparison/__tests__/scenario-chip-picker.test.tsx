// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { ScenarioChipPicker } from "../scenario-chip-picker";

const scenarios = [
  { id: "base", name: "Base" },
  { id: "sc-1", name: "Roth Heavy" },
  { id: "sc-2", name: "Late SS" },
];

describe("ScenarioChipPicker", () => {
  it("'none' cardinality renders nothing", () => {
    const { container } = render(
      <ScenarioChipPicker
        cardinality="none"
        scenarios={scenarios}
        planIds={[]}
        onChange={vi.fn()}
      />,
    );
    expect(container.textContent).toBe("");
  });

  it("'one' is radio-style: clicking a chip replaces the selection", () => {
    const onChange = vi.fn();
    render(
      <ScenarioChipPicker
        cardinality="one"
        scenarios={scenarios}
        planIds={["base"]}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByText("Roth Heavy"));
    expect(onChange).toHaveBeenCalledWith(["sc-1"]);
  });

  it("'one-or-many' toggles chips; deselecting last is blocked", () => {
    const onChange = vi.fn();
    render(
      <ScenarioChipPicker
        cardinality="one-or-many"
        scenarios={scenarios}
        planIds={["base"]}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByText("Roth Heavy"));
    expect(onChange).toHaveBeenLastCalledWith(["base", "sc-1"]);

    // Deselecting the only one is blocked.
    onChange.mockClear();
    render(
      <ScenarioChipPicker
        cardinality="one-or-many"
        scenarios={scenarios}
        planIds={["base"]}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getAllByText("Base")[0]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("'many-only' refuses to drop below 2 plans", () => {
    const onChange = vi.fn();
    render(
      <ScenarioChipPicker
        cardinality="many-only"
        scenarios={scenarios}
        planIds={["base", "sc-1"]}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByText("Base"));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Late SS"));
    expect(onChange).toHaveBeenCalledWith(["base", "sc-1", "sc-2"]);
  });
});
