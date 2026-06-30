// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SelectedPageRow } from "../selected-page-row";
import { RETIREMENT_COMPARISON_OPTIONS_DEFAULT } from "@/lib/presentations/pages/retirement-comparison/options-schema";

const baseProps = {
  index: 0,
  pageId: "cashFlow" as const,
  options: { range: "full", showCallout: true },
  scenarioOverride: undefined as string | null | undefined,
  deckScenarioLabel: "Base case",
  onOptionsChange: vi.fn(),
  onScenarioOverrideChange: vi.fn(),
  onRemove: vi.fn(),
  onPreview: vi.fn(),
  onDownload: vi.fn(),
  scenarios: [],
  snapshots: [],
};

describe("SelectedPageRow", () => {
  it("shows the page title and summary chip", () => {
    render(<SelectedPageRow {...baseProps} />);
    expect(screen.getByText("Cash Flow")).toBeInTheDocument();
    expect(screen.getByText("Full range")).toBeInTheDocument();
  });

  it("calls onRemove when remove button clicked", () => {
    const onRemove = vi.fn();
    render(<SelectedPageRow {...baseProps} onRemove={onRemove} />);
    fireEvent.click(screen.getByLabelText("Remove Cash Flow"));
    expect(onRemove).toHaveBeenCalled();
  });

  it("expands options when disclosure is toggled and emits onOptionsChange", () => {
    const onOptionsChange = vi.fn();
    render(<SelectedPageRow {...baseProps} onOptionsChange={onOptionsChange} />);
    fireEvent.click(screen.getByText("Options"));
    fireEvent.click(screen.getByLabelText("Custom"));
    expect(onOptionsChange).toHaveBeenCalledWith(
      expect.objectContaining({
        showCallout: true,
        range: expect.objectContaining({ startYear: expect.any(Number), endYear: expect.any(Number) }),
      }),
    );
  });

  it("shows an inline scenario picker that defaults to the deck scenario", () => {
    render(<SelectedPageRow {...baseProps} deckScenarioLabel="Aggressive" />);
    const select = screen.getByLabelText(
      "Scenario for Cash Flow",
    ) as HTMLSelectElement;
    const defaultOption = screen.getByRole("option", {
      name: "Default (Aggressive)",
    }) as HTMLOptionElement;
    // No override → the picker rests on the leading "Default (…)" option.
    expect(select.value).toBe(defaultOption.value);
  });

  it("emits the scenario id when a scenario is picked", () => {
    const onScenarioOverrideChange = vi.fn();
    render(
      <SelectedPageRow
        {...baseProps}
        onScenarioOverrideChange={onScenarioOverrideChange}
        scenarios={[{ id: "sc-1", name: "Aggressive", isBaseCase: false }]}
      />,
    );
    fireEvent.change(screen.getByLabelText("Scenario for Cash Flow"), {
      target: { value: "sc-1" },
    });
    expect(onScenarioOverrideChange).toHaveBeenCalledWith("sc-1");
  });

  it("emits undefined when the leading 'Default' option is re-selected", () => {
    const onScenarioOverrideChange = vi.fn();
    render(
      <SelectedPageRow
        {...baseProps}
        scenarioOverride="sc-1"
        onScenarioOverrideChange={onScenarioOverrideChange}
        scenarios={[{ id: "sc-1", name: "Aggressive", isBaseCase: false }]}
      />,
    );
    const defaultOption = screen.getByRole("option", {
      name: "Default (Base case)",
    }) as HTMLOptionElement;
    fireEvent.change(screen.getByLabelText("Scenario for Cash Flow"), {
      target: { value: defaultOption.value },
    });
    expect(onScenarioOverrideChange).toHaveBeenCalledWith(undefined);
  });

  // Retirement Comparison stores its "compare to" scenario inside options
  // (baseline is always Base Case), so the trailing control is an inline
  // comparison picker rather than the static "Base plan" chip.
  const comparisonProps = {
    ...baseProps,
    pageId: "retirementComparison" as const,
    options: RETIREMENT_COMPARISON_OPTIONS_DEFAULT,
    scenarios: [
      { id: "sc-1", name: "Aggressive", isBaseCase: false },
      { id: "base", name: "Base case", isBaseCase: true },
    ],
  };

  it("renders an inline comparison picker (not the 'Base plan' chip)", () => {
    render(<SelectedPageRow {...comparisonProps} />);
    const select = screen.getByLabelText(
      "Comparison scenario for Retirement Comparison",
    ) as HTMLSelectElement;
    // Unset → rests on the "Compare to…" placeholder; base case is excluded.
    expect(select.value).toBe("");
    expect(
      screen.getByRole("option", { name: "Compare to…" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Aggressive" })).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "Base case" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Base plan")).not.toBeInTheDocument();
  });

  it("writes the picked scenario into the page's options.scenarioId", () => {
    const onOptionsChange = vi.fn();
    render(
      <SelectedPageRow
        {...comparisonProps}
        onOptionsChange={onOptionsChange}
      />,
    );
    fireEvent.change(
      screen.getByLabelText("Comparison scenario for Retirement Comparison"),
      { target: { value: "sc-1" } },
    );
    expect(onOptionsChange).toHaveBeenCalledWith(
      expect.objectContaining({ scenarioId: "sc-1" }),
    );
  });
});
