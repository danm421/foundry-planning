// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RetirementComparisonOptionsControl } from "./options-control";
import { PresentationOptionsProvider } from "@/components/presentations/options-context";
import { EMPTY_INVESTMENT_OPTION_CATALOG } from "@/lib/presentations/investment-option-catalog";
import { RETIREMENT_COMPARISON_OPTIONS_DEFAULT } from "@/lib/presentations/pages/retirement-comparison/options-schema";
import type { RetirementComparisonOptions } from "@/lib/presentations/pages/retirement-comparison/types";

function renderControl(
  overrides: Partial<RetirementComparisonOptions> = {},
  onChange = vi.fn(),
  scenarios: { id: string; name: string; isBaseCase: boolean }[] = [],
) {
  const value = { ...RETIREMENT_COMPARISON_OPTIONS_DEFAULT, ...overrides };
  render(
    <PresentationOptionsProvider
      value={{ investmentCatalog: EMPTY_INVESTMENT_OPTION_CATALOG, scenarios, clientId: "c1" }}
    >
      <RetirementComparisonOptionsControl value={value} onChange={onChange} />
    </PresentationOptionsProvider>,
  );
  return { onChange };
}

const SCENARIOS = [
  { id: "base", name: "Base Case", isBaseCase: true },
  { id: "s1", name: "Retire at 62", isBaseCase: false },
  { id: "s2", name: "Retire at 65", isBaseCase: false },
];

describe("RetirementComparisonOptionsControl", () => {
  it("renders Display, Max spending and AI summary sections", () => {
    renderControl();
    expect(screen.getByText("Display")).toBeInTheDocument();
    expect(screen.getByText("Max spending")).toBeInTheDocument();
    expect(screen.getByText("AI summary")).toBeInTheDocument();
  });

  it("shows the generated summary in an editable textbox", () => {
    renderControl({
      ai: { ...RETIREMENT_COMPARISON_OPTIONS_DEFAULT.ai, generatedText: "Hello summary" },
    });
    const box = screen.getByLabelText("AI summary text") as HTMLTextAreaElement;
    expect(box.value).toBe("Hello summary");
  });

  it("emits onChange when the summary text is edited", () => {
    const { onChange } = renderControl();
    fireEvent.change(screen.getByLabelText("AI summary text"), {
      target: { value: "Edited summary" },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        ai: expect.objectContaining({ generatedText: "Edited summary" }),
      }),
    );
  });

  it("offers Base Case plus every live scenario as a baseline", () => {
    renderControl({}, vi.fn(), SCENARIOS);
    const select = screen.getByLabelText("Baseline plan") as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(["base", "s1", "s2"]);
  });

  it("excludes the baseline from the comparison list and vice versa", () => {
    renderControl({ baselineScenarioId: "s1" }, vi.fn(), SCENARIOS);
    const comparison = screen.getByLabelText("Comparison scenario") as HTMLSelectElement;
    expect([...comparison.options].map((o) => o.value)).not.toContain("s1");
  });

  it("reports a baseline change", () => {
    const { onChange } = renderControl({}, vi.fn(), SCENARIOS);
    fireEvent.change(screen.getByLabelText("Baseline plan"), { target: { value: "s2" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ baselineScenarioId: "s2" }));
  });
});
