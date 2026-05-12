// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { kpiWidget } from "../kpi";

describe("kpi.renderConfig", () => {
  it("renders a select with all five metrics", () => {
    expect(kpiWidget.renderConfig).toBeDefined();
    const onChange = vi.fn();
    render(<>{kpiWidget.renderConfig!({ config: { metric: "endNetWorth" }, onChange })}</>);
    const sel = screen.getByLabelText(/Metric/i) as HTMLSelectElement;
    expect(sel.value).toBe("endNetWorth");
    const options = Array.from(sel.options).map((o) => o.value);
    expect(options).toEqual([
      "successProbability",
      "longevityAge",
      "endNetWorth",
      "lifetimeTax",
      "netToHeirs",
    ]);
  });

  it("invokes onChange with the new config when the select changes", () => {
    const onChange = vi.fn();
    render(<>{kpiWidget.renderConfig!({ config: { metric: "endNetWorth" }, onChange })}</>);
    const sel = screen.getByLabelText(/Metric/i) as HTMLSelectElement;
    fireEvent.change(sel, { target: { value: "lifetimeTax" } });
    expect(onChange).toHaveBeenCalledWith({ metric: "lifetimeTax" });
  });

  it("falls back to endNetWorth when config has no metric", () => {
    const onChange = vi.fn();
    render(<>{kpiWidget.renderConfig!({ config: undefined, onChange })}</>);
    const sel = screen.getByLabelText(/Metric/i) as HTMLSelectElement;
    expect(sel.value).toBe("endNetWorth");
  });
});
