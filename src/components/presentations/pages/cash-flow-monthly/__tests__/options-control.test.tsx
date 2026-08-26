// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { MonthlyCashFlowOptionsControl } from "../options-control";
import {
  MONTHLY_CASH_FLOW_OPTIONS_DEFAULT,
  type MonthlyCashFlowPageOptions,
} from "@/lib/presentations/pages/cash-flow-monthly/types";

function setup(value: MonthlyCashFlowPageOptions = MONTHLY_CASH_FLOW_OPTIONS_DEFAULT) {
  const onChange = vi.fn();
  const view = render(<MonthlyCashFlowOptionsControl value={value} onChange={onChange} />);
  return { ...view, onChange };
}

const MONTHS: MonthlyCashFlowPageOptions = {
  view: "months",
  basis: "today",
  range: "full",
  year: null,
};

describe("MonthlyCashFlowOptionsControl", () => {
  it("lets the advisor choose which of the two tables the sheet prints", () => {
    const { getByLabelText, onChange } = setup();
    fireEvent.change(getByLabelText("Show"), { target: { value: "months" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ view: "months" }));
  });

  it("switches the dollar basis", () => {
    const { getByLabelText, onChange } = setup();
    fireEvent.change(getByLabelText("Dollars"), { target: { value: "nominal" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ basis: "nominal" }));
  });

  // One render per test: both are mounted into the same document body, so a
  // second `setup()` in the same test would leave the first control's controls
  // visible to the query and the negative assertion could never fail.
  it("offers the year range on the plan table, and no year picker", () => {
    const plan = setup();
    expect(plan.getByLabelText("Full")).toBeTruthy();
    expect(plan.queryByLabelText("Year")).toBeNull();
  });

  it("offers the year picker on the month table, and no range", () => {
    // Offering both at once would show a range the month table ignores.
    const months = setup(MONTHS);
    expect(months.getByLabelText("Year")).toBeTruthy();
    expect(months.queryByLabelText("Full")).toBeNull();
  });

  it("clearing the year means 'let the plan decide', not year zero", () => {
    const { getByLabelText, onChange } = setup({ ...MONTHS, year: 2044 });
    fireEvent.change(getByLabelText("Year"), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ year: null }));
  });

  it("keeps the year range while the month view is showing, so switching back restores it", () => {
    const { getByLabelText, onChange } = setup({
      ...MONTHS,
      range: { startYear: 2041, endYear: 2050 },
    });
    fireEvent.change(getByLabelText("Show"), { target: { value: "plan" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ range: { startYear: 2041, endYear: 2050 } }),
    );
  });
});
