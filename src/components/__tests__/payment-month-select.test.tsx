// @vitest-environment jsdom
/**
 * The "Paid in" control on income and expense rows.
 *
 * Null means "spread the year's amount evenly across all twelve months", which
 * is why the empty option reads "Monthly" — it names what the plan DOES with an
 * untimed row rather than the setting the advisor declined to make.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PaymentMonthSelect } from "@/components/forms/payment-month-select";

describe("PaymentMonthSelect", () => {
  it("shows Monthly when nothing is chosen", () => {
    render(<PaymentMonthSelect id="t" value={null} onChange={() => {}} />);
    const el = screen.getByLabelText("Paid in") as HTMLSelectElement;
    expect(el.value).toBe("");
    // The default names what the plan DOES, not what the advisor declined to set.
    expect(screen.getByRole("option", { name: "Monthly" })).toBeTruthy();
  });

  it("offers all twelve months", () => {
    render(<PaymentMonthSelect id="t" value={null} onChange={() => {}} />);
    for (const m of ["January", "June", "December"]) {
      expect(screen.getByRole("option", { name: m })).toBeTruthy();
    }
    expect(screen.getAllByRole("option")).toHaveLength(13);
  });

  it("reports a chosen month as a number, and Monthly as null", () => {
    const onChange = vi.fn();
    render(<PaymentMonthSelect id="t" value={null} onChange={onChange} />);
    const el = screen.getByLabelText("Paid in");
    fireEvent.change(el, { target: { value: "3" } });
    expect(onChange).toHaveBeenCalledWith(3);
    fireEvent.change(el, { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("reflects an existing value", () => {
    render(<PaymentMonthSelect id="t" value={11} onChange={() => {}} />);
    expect((screen.getByLabelText("Paid in") as HTMLSelectElement).value).toBe("11");
  });
});
