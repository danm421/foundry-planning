// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TaxComparisonOptionsControl } from "./options-control";
import { PresentationOptionsProvider } from "@/components/presentations/options-context";
import { TAX_COMPARISON_OPTIONS_DEFAULT } from "@/lib/presentations/pages/tax-comparison/options-schema";
import { EMPTY_INVESTMENT_OPTION_CATALOG } from "@/lib/presentations/investment-option-catalog";

const SCENARIOS = [
  { id: "base", name: "Base Case", isBaseCase: true },
  { id: "s1", name: "Retire at 62", isBaseCase: false },
  { id: "s2", name: "Retire at 65", isBaseCase: false },
];

function renderControl(value = TAX_COMPARISON_OPTIONS_DEFAULT, onChange = vi.fn()) {
  render(
    <PresentationOptionsProvider
      value={{ investmentCatalog: EMPTY_INVESTMENT_OPTION_CATALOG, scenarios: SCENARIOS, clientId: "c1" }}
    >
      <TaxComparisonOptionsControl value={value} onChange={onChange} />
    </PresentationOptionsProvider>,
  );
  return onChange;
}

describe("TaxComparisonOptionsControl", () => {
  it("offers Base Case plus every live scenario as a baseline", () => {
    renderControl();
    const select = screen.getByLabelText("Baseline plan") as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(["base", "s1", "s2"]);
  });

  it("excludes the comparison scenario from the baseline list", () => {
    renderControl({ ...TAX_COMPARISON_OPTIONS_DEFAULT, scenarioId: "s1" });
    const select = screen.getByLabelText("Baseline plan") as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(["base", "s2"]);
  });

  it("reports a baseline change", () => {
    const onChange = renderControl();
    fireEvent.change(screen.getByLabelText("Baseline plan"), { target: { value: "s2" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ baselineScenarioId: "s2" }));
  });

  it("exposes the bracket thresholds, which had no UI before", () => {
    renderControl();
    expect(screen.getByLabelText("Low bracket threshold")).toBeTruthy();
    expect(screen.getByLabelText("High bracket threshold")).toBeTruthy();
  });
});
