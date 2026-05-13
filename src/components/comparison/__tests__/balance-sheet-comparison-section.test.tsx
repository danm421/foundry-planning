// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
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
  it("renders owner-column matrix with Cooper / Susan / Joint/ROS + Total", () => {
    const plan = mkPlan("A", {
      accounts: [
        {
          id: "a-cash",
          name: "CASH - Checking",
          category: "cash",
          value: 50_000,
          owners: [
            { kind: "family_member", familyMemberId: "fm-client", percent: 0.5 },
            { kind: "family_member", familyMemberId: "fm-spouse", percent: 0.5 },
          ],
        },
        {
          id: "a-401k-c",
          name: "INV - Client 401k",
          category: "retirement",
          value: 400_000,
          owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
        },
        {
          id: "a-401k-s",
          name: "INV - Spouse 401k",
          category: "retirement",
          value: 350_000,
          owners: [{ kind: "family_member", familyMemberId: "fm-spouse", percent: 1 }],
        },
      ],
      liabilities: [],
      familyMembers: [
        { id: "fm-client", role: "client", firstName: "Cooper" },
        { id: "fm-spouse", role: "spouse", firstName: "Susan" },
      ],
      entities: [],
    } as unknown as ComparisonPlan["tree"]);
    render(<BalanceSheetComparisonSection plans={[plan]} />);
    // Column headers in order.
    expect(screen.getByRole("columnheader", { name: "Cooper" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Susan" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Joint/ROS" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Total" })).toBeTruthy();
    // CASH joint row: full $50,000 lands in Joint/ROS + Total only.
    const cashRow = screen.getByText("CASH - Checking").closest("tr")!;
    const cashCells = within(cashRow).getAllByRole("cell");
    expect(cashCells[1].textContent).toBe("—"); // Cooper
    expect(cashCells[2].textContent).toBe("—"); // Susan
    expect(cashCells[3].textContent).toBe("$50,000"); // Joint/ROS
    expect(cashCells[4].textContent).toBe("$50,000"); // Total
    // Client 401k → Cooper column only.
    const c401kRow = screen.getByText("INV - Client 401k").closest("tr")!;
    const c401kCells = within(c401kRow).getAllByRole("cell");
    expect(c401kCells[1].textContent).toBe("$400,000");
    expect(c401kCells[2].textContent).toBe("—");
    expect(c401kCells[3].textContent).toBe("—");
    expect(c401kCells[4].textContent).toBe("$400,000");
    // Total Assets row: column totals + grand total.
    const totalRow = screen.getByText("Total Assets").closest("tr")!;
    const totalCells = within(totalRow).getAllByRole("cell");
    expect(totalCells[1].textContent).toBe("$400,000"); // Cooper
    expect(totalCells[2].textContent).toBe("$350,000"); // Susan
    expect(totalCells[3].textContent).toBe("$50,000"); // Joint/ROS
    expect(totalCells[4].textContent).toBe("$800,000"); // Total
  });

  it("adds entity and child columns when present, splitting mixed ownership proportionally", () => {
    const plan = mkPlan("A", {
      accounts: [
        {
          id: "a-entity",
          name: "Family Trust Brokerage",
          category: "taxable",
          value: 750_000,
          owners: [{ kind: "entity", entityId: "ent-trust", percent: 1 }],
        },
        {
          id: "a-utma",
          name: "UTMA for Junior",
          category: "taxable",
          value: 25_000,
          owners: [{ kind: "family_member", familyMemberId: "fm-child", percent: 1 }],
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
        { id: "fm-child", role: "child", firstName: "Junior" },
      ],
      entities: [{ id: "ent-trust", name: "Family Trust" }],
    } as unknown as ComparisonPlan["tree"]);
    render(<BalanceSheetComparisonSection plans={[plan]} />);
    // Headers include Pat (client), Junior (child), Family Trust (entity).
    expect(screen.getByRole("columnheader", { name: "Pat" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Junior" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Family Trust" })).toBeTruthy();
    // Mixed row splits 50/50 between Pat and Family Trust columns.
    const mixedRow = screen.getByText("Mixed Ownership Property").closest("tr")!;
    const cells = within(mixedRow).getAllByRole("cell");
    // Order: name | Pat | Junior | Family Trust | Total
    expect(cells[1].textContent).toBe("$250,000");
    expect(cells[2].textContent).toBe("—");
    expect(cells[3].textContent).toBe("$250,000");
    expect(cells[4].textContent).toBe("$500,000");
  });

  it("renders liabilities and net worth", () => {
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
    expect(screen.getByText("Home Mortgage")).toBeTruthy();
    expect(screen.getByText(/Net Worth/)).toBeTruthy();
    expect(screen.getByText(/\$150,000/)).toBeTruthy();
  });
});
