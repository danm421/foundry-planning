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
      { id: "k1", name: "Kid Brokerage", category: "taxable", subType: "brokerage", ownerFamilyMemberIds: ["child-a"] },
      { id: "o1", name: "Other Kid Brokerage", category: "taxable", subType: "brokerage", ownerFamilyMemberIds: ["child-b"] },
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
    expect(screen.getByText("Kid Brokerage")).toBeTruthy();
    // Owned only by a different child — excluded. (A 529 is exempt from this
    // filter and stays listed; see the 529 suite below.)
    expect(screen.queryByText("Other Kid Brokerage")).toBeNull();
  });
});

/**
 * A 529 has no family-member owner by construction: the loader replaces its
 * owners with an out-of-estate sentinel (engine/ownership.ts). Before this
 * suite, the picker's ownership filter read that empty list and silently
 * dropped the account — so on a real household the only college asset in the
 * plan was the one thing the advisor could not pick.
 */
describe("DedicatedFundingPicker — 529s and the ownership filter", () => {
  const names = { client: "Mike", "child-a": "Emma", "child-b": "Jack" };

  it("keeps a 529 with no beneficiary on file — there is nothing to filter it out by", () => {
    const accounts = [
      { id: "k1", name: "Education Savings", category: "education_savings", subType: "529" },
      { id: "n1", name: "Nephew Brokerage", category: "taxable", subType: "brokerage", ownerFamilyMemberIds: ["child-b"] },
    ];
    render(
      <DedicatedFundingPicker
        accounts={accounts as never}
        value={[]}
        onChange={vi.fn()}
        allowedOwnerFamilyMemberIds={["client", "child-a"]}
        familyMemberNames={names}
      />,
    );
    expect(screen.getByLabelText("Education Savings")).toBeTruthy();
    expect(screen.getByText(/no beneficiary on file/i)).toBeTruthy();
    // The ownership filter still bites for everything that isn't a 529.
    expect(screen.queryByText("Nephew Brokerage")).toBeNull();
  });

  it("keeps another child's 529 and names whose it is, rather than hiding it", () => {
    const accounts = [
      { id: "k2", name: "College Fund", category: "education_savings", subType: "529", beneficiaryFamilyMemberId: "child-b" },
    ];
    render(
      <DedicatedFundingPicker
        accounts={accounts as never}
        value={[]}
        onChange={vi.fn()}
        allowedOwnerFamilyMemberIds={["client", "child-a"]}
        familyMemberNames={names}
      />,
    );
    expect(screen.getByLabelText("College Fund")).toBeTruthy();
    expect(screen.getByText("· for Jack")).toBeTruthy();
  });

  it("falls back to the beneficiary's typed-in name when they aren't a family member", () => {
    const accounts = [
      { id: "k3", name: "Grandparent 529", category: "education_savings", subType: "529", beneficiaryName: "Chris" },
    ];
    render(
      <DedicatedFundingPicker
        accounts={accounts as never}
        value={[]}
        onChange={vi.fn()}
        allowedOwnerFamilyMemberIds={["client"]}
        familyMemberNames={names}
      />,
    );
    expect(screen.getByText("· for Chris")).toBeTruthy();
  });

  it("says the list was narrowed, instead of claiming the plan has no eligible accounts", () => {
    const accounts = [
      { id: "n1", name: "Nephew Brokerage", category: "taxable", subType: "brokerage", ownerFamilyMemberIds: ["child-b"] },
    ];
    render(
      <DedicatedFundingPicker
        accounts={accounts as never}
        value={[]}
        onChange={vi.fn()}
        allowedOwnerFamilyMemberIds={["client", "child-a"]}
      />,
    );
    expect(screen.getByText(/belong to someone outside this goal/i)).toBeTruthy();
  });
});
