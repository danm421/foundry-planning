// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { ComparisonPickerBar } from "../comparison-picker-bar";

const setSide = vi.fn();
vi.mock("@/hooks/use-compare-state", () => ({
  useCompareState: () => ({ left: "base", right: "scen-1", setSide }),
}));

describe("ComparisonPickerBar", () => {
  it("renders both pickers with current selections", () => {
    const { getAllByRole } = render(
      <ComparisonPickerBar
        clientId="client-1"
        scenarios={[
          { id: "base", name: "Base", isBaseCase: true },
          { id: "scen-1", name: "Scenario 1", isBaseCase: false },
        ]}
        snapshots={[]}
      />,
    );
    const selects = getAllByRole("combobox");
    expect(selects).toHaveLength(2);
    expect((selects[0] as HTMLSelectElement).value).toBe("base");
    expect((selects[1] as HTMLSelectElement).value).toBe("scen-1");
  });

  it("calls setSide with new value when picker changes", () => {
    const { getAllByRole } = render(
      <ComparisonPickerBar
        clientId="client-1"
        scenarios={[
          { id: "base", name: "Base", isBaseCase: true },
          { id: "scen-1", name: "Scenario 1", isBaseCase: false },
        ]}
        snapshots={[]}
      />,
    );
    fireEvent.change(getAllByRole("combobox")[1], { target: { value: "base" } });
    expect(setSide).toHaveBeenCalledWith("right", "base");
  });
});
