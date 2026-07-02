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

  it("excludes non-529 retirement accounts (cash / taxable / 529 only)", () => {
    const withRetirement = [
      { id: "r1", name: "401k", category: "retirement", subType: "401k" },
      { id: "c1", name: "Checking", category: "cash", subType: "checking" },
    ];
    render(<DedicatedFundingPicker accounts={withRetirement as never} value={[]} onChange={vi.fn()} />);
    expect(screen.queryByText("401k")).toBeNull();
    expect(screen.getByText("Checking")).toBeTruthy();
  });

  it("filters to accounts owned by the household or the beneficiary when allowed ids are given", () => {
    const owned = [
      { id: "p1", name: "Parent Brokerage", category: "taxable", subType: "brokerage", ownerFamilyMemberIds: ["client"] },
      { id: "k1", name: "Kid 529", category: "taxable", subType: "529", ownerFamilyMemberIds: ["child-a"] },
      { id: "o1", name: "Other Kid 529", category: "taxable", subType: "529", ownerFamilyMemberIds: ["child-b"] },
    ];
    render(
      <DedicatedFundingPicker
        accounts={owned as never}
        value={[]}
        onChange={vi.fn()}
        allowedOwnerFamilyMemberIds={["client", "child-a"]}
      />,
    );
    expect(screen.getByText("Parent Brokerage")).toBeTruthy();
    expect(screen.getByText("Kid 529")).toBeTruthy();
    // Owned only by a different child — excluded.
    expect(screen.queryByText("Other Kid 529")).toBeNull();
  });
});
