// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DedicatedFundingPicker } from "../dedicated-funding-picker";

const accounts = [
  { id: "a1", name: "529 - Caroline", category: "retirement", subType: "529" },
  { id: "a2", name: "Brokerage", category: "taxable", subType: "brokerage" },
  { id: "h1", name: "Home", category: "real_estate", subType: "primary" },
];

describe("DedicatedFundingPicker", () => {
  it("lists only investable accounts and toggles selection in order", () => {
    const onChange = vi.fn();
    render(<DedicatedFundingPicker accounts={accounts as never} value={[]} onChange={onChange} />);
    // real estate excluded
    expect(screen.queryByText("Home")).toBeNull();
    fireEvent.click(screen.getByLabelText("529 - Caroline"));
    expect(onChange).toHaveBeenCalledWith(["a1"]);
  });

  it("preserves selection order when adding a second account", () => {
    const onChange = vi.fn();
    render(<DedicatedFundingPicker accounts={accounts as never} value={["a2"]} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("529 - Caroline"));
    expect(onChange).toHaveBeenCalledWith(["a2", "a1"]);
  });
});
