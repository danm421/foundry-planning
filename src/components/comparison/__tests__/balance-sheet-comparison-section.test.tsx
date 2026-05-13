// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BalanceSheetComparisonSection } from "../balance-sheet-comparison-section";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";

function mkPlan(label: string, tree: Partial<ComparisonPlan["tree"]>): ComparisonPlan {
  return {
    index: 0,
    isBaseline: true,
    ref: { kind: "scenario", id: label },
    id: label,
    label,
    tree: tree as ComparisonPlan["tree"],
    result: { years: [] } as unknown as ComparisonPlan["result"],
    lifetime: {} as ComparisonPlan["lifetime"],
    liquidityRows: [],
    finalEstate: null,
    panelData: null,
    allocation: null,
  };
}

describe("BalanceSheetComparisonSection", () => {
  it("renders all five ownerLabelFor branches in the Owner column", () => {
    // Each account exercises a distinct branch of `ownerLabelFor`:
    //  - joint  (2 family_member owners, roles client+spouse, 0.5/0.5)
    //  - single non-principal family_member (1.0, role=child) -> firstName
    //  - single entity (1.0) -> entity.name
    //  - 3 family_member owners -> "shared"
    //  - family_member + entity -> "mixed"
    const plan = mkPlan("A", {
      accounts: [
        {
          id: "a-joint",
          name: "Joint Brokerage",
          category: "taxable",
          value: 100_000,
          owners: [
            { kind: "family_member", familyMemberId: "fm-client", percent: 0.5 },
            { kind: "family_member", familyMemberId: "fm-spouse", percent: 0.5 },
          ],
        },
        {
          id: "a-child",
          name: "UTMA for Junior",
          category: "taxable",
          value: 25_000,
          owners: [{ kind: "family_member", familyMemberId: "fm-child", percent: 1 }],
        },
        {
          id: "a-entity",
          name: "Family Trust Brokerage",
          category: "taxable",
          value: 750_000,
          owners: [{ kind: "entity", entityId: "ent-trust", percent: 1 }],
        },
        {
          id: "a-shared",
          name: "Shared Family LLC Distribution",
          category: "business",
          value: 60_000,
          owners: [
            { kind: "family_member", familyMemberId: "fm-client", percent: 0.34 },
            { kind: "family_member", familyMemberId: "fm-spouse", percent: 0.33 },
            { kind: "family_member", familyMemberId: "fm-child", percent: 0.33 },
          ],
        },
        {
          id: "a-mixed",
          name: "Mixed Ownership Property",
          category: "real_estate",
          value: 500_000,
          owners: [
            { kind: "family_member", familyMemberId: "fm-client", percent: 0.5 },
            { kind: "entity", entityId: "ent-trust", percent: 0.5 },
          ],
        },
      ],
      liabilities: [],
      familyMembers: [
        { id: "fm-client", role: "client", firstName: "Pat" },
        { id: "fm-spouse", role: "spouse", firstName: "Sam" },
        { id: "fm-child", role: "child", firstName: "Junior" },
      ],
      entities: [{ id: "ent-trust", name: "Family Trust" }],
    } as unknown as ComparisonPlan["tree"]);
    render(<BalanceSheetComparisonSection plans={[plan]} />);
    // joint: client+spouse, both with role tags, 0.5/0.5
    expect(screen.getByText("joint")).toBeTruthy();
    // single non-principal family member -> firstName fallback
    expect(screen.getByText("Junior")).toBeTruthy();
    // single entity -> entity.name
    expect(screen.getByText("Family Trust")).toBeTruthy();
    // 3 family_member owners -> "shared"
    expect(screen.getByText("shared")).toBeTruthy();
    // family_member + entity -> "mixed"
    expect(screen.getByText("mixed")).toBeTruthy();
  });

  it("renders accounts and liabilities with totals and net worth", () => {
    const plan = mkPlan("A", {
      accounts: [
        {
          id: "a1",
          name: "CASH - Checking",
          category: "cash",
          value: 50_000,
          owners: [
            { kind: "family_member", familyMemberId: "fm-client", percent: 0.5 },
            { kind: "family_member", familyMemberId: "fm-spouse", percent: 0.5 },
          ],
        },
        {
          id: "a2",
          name: "INV - Client 401k",
          category: "retirement",
          value: 400_000,
          owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
        },
      ],
      liabilities: [
        {
          id: "l1",
          name: "Home Mortgage",
          balance: 300_000,
          owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
        },
      ],
      familyMembers: [
        { id: "fm-client", role: "client", firstName: "Pat" },
        { id: "fm-spouse", role: "spouse", firstName: "Sam" },
      ],
      entities: [],
    } as unknown as ComparisonPlan["tree"]);
    render(<BalanceSheetComparisonSection plans={[plan]} />);
    expect(screen.getByText("CASH - Checking")).toBeTruthy();
    expect(screen.getByText("INV - Client 401k")).toBeTruthy();
    expect(screen.getByText("Home Mortgage")).toBeTruthy();
    // Total Assets = 450,000 ; Total Liabilities = 300,000 (also appears as
    // the single Home Mortgage row, hence getAllByText) ; Net Worth = 150,000.
    expect(screen.getByText(/\$450,000/)).toBeTruthy();
    expect(screen.getAllByText(/\$300,000/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/\$150,000/)).toBeTruthy();
  });
});
