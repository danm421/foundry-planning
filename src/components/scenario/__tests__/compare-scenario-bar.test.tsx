// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { CompareScenarioBar } from "../compare-scenario-bar";
import type {
  ScenarioOption,
  SnapshotOption,
} from "../scenario-picker-dropdown";

const setSideMock = vi.fn();
let mockLeft = "base";
let mockRight = "base";

vi.mock("@/hooks/use-compare-state", () => ({
  useCompareState: () => ({
    left: mockLeft,
    right: mockRight,
    toggleSet: new Set<string>(),
    setSide: setSideMock,
    setToggle: vi.fn(),
  }),
}));

const SCENARIOS: ScenarioOption[] = [
  { id: "base", name: "Base case", isBaseCase: true },
  { id: "s1", name: "Roth conversion", isBaseCase: false },
  { id: "s2", name: "Early retirement", isBaseCase: false },
];

const SNAPSHOTS: SnapshotOption[] = [
  { id: "snap-m1", name: "Manual A", sourceKind: "manual" },
];

describe("CompareScenarioBar", () => {
  beforeEach(() => {
    setSideMock.mockClear();
    mockLeft = "base";
    mockRight = "base";
  });

  it("renders COMPARING label, both dropdowns, and a 'vs' separator", () => {
    render(
      <CompareScenarioBar
        clientId="c1"
        scenarios={SCENARIOS}
        snapshots={SNAPSHOTS}
      />,
    );
    expect(screen.getByTestId("compare-scenario-bar")).toBeInTheDocument();
    expect(screen.getByText("COMPARING")).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Left scenario" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Right scenario" }),
    ).toBeInTheDocument();
    expect(screen.getByText("vs")).toBeInTheDocument();
  });

  it("pickers reflect URL state and round-trip through setSide", () => {
    mockLeft = "s1";
    mockRight = "snap:snap-m1";
    render(
      <CompareScenarioBar
        clientId="c1"
        scenarios={SCENARIOS}
        snapshots={SNAPSHOTS}
      />,
    );
    const leftSelect = screen.getByRole("combobox", {
      name: "Left scenario",
    }) as HTMLSelectElement;
    const rightSelect = screen.getByRole("combobox", {
      name: "Right scenario",
    }) as HTMLSelectElement;
    expect(leftSelect.value).toBe("s1");
    expect(rightSelect.value).toBe("snap:snap-m1");

    fireEvent.change(leftSelect, { target: { value: "s2" } });
    expect(setSideMock).toHaveBeenCalledWith("left", "s2");

    fireEvent.change(rightSelect, { target: { value: "base" } });
    expect(setSideMock).toHaveBeenCalledWith("right", "base");
  });
});
