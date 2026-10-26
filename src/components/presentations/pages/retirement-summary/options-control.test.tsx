// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RetirementSummaryOptionsControl } from "./options-control";
import { RETIREMENT_SUMMARY_OPTIONS_DEFAULT } from "@/lib/presentations/pages/retirement-summary/options-schema";
import type { RetirementSummaryOptions } from "@/lib/presentations/pages/retirement-summary/options-schema";

function renderControl(value: RetirementSummaryOptions = RETIREMENT_SUMMARY_OPTIONS_DEFAULT) {
  const onChange = vi.fn();
  render(<RetirementSummaryOptionsControl value={value} onChange={onChange} />);
  return { onChange };
}

describe("RetirementSummaryOptionsControl", () => {
  it("switches the max-spend card on at the current target", () => {
    const { onChange } = renderControl();
    fireEvent.click(screen.getByLabelText("Show max sustainable spend"));
    expect(onChange).toHaveBeenCalledWith({ maxSpend: { show: true, targetConfidence: 0.85 } });
  });

  it("changes the confidence target", () => {
    const { onChange } = renderControl({ maxSpend: { show: true, targetConfidence: 0.85 } });
    fireEvent.change(screen.getByLabelText("Max-spending confidence target"), { target: { value: "0.9" } });
    expect(onChange).toHaveBeenCalledWith({ maxSpend: { show: true, targetConfidence: 0.9 } });
  });

  it("only lets the target be picked while the card is on", () => {
    renderControl();
    expect(screen.getByLabelText("Max-spending confidence target")).toBeDisabled();
  });

  it("opens a saved template's raw options, which may predate the setting", () => {
    const { onChange } = renderControl({} as never);
    fireEvent.click(screen.getByLabelText("Show max sustainable spend"));
    expect(onChange).toHaveBeenCalledWith({ maxSpend: { show: true, targetConfidence: 0.85 } });
  });
});
