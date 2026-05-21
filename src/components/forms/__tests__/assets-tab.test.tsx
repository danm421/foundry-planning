// @vitest-environment jsdom
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import AssetsTab from "../assets-tab";
import type { AssetsTabAccount, AssetsTabLiability, AssetsTabIncome, AssetsTabExpense, AssetsTabFamilyMember, AssetsTabBusiness } from "../assets-tab";

const TRUST_ID = "trust-abc";

const accounts: AssetsTabAccount[] = [
  {
    id: "acc-1",
    name: "Brokerage Account",
    value: 250_000,
    subType: "taxable",
    owners: [{ kind: "entity", entityId: TRUST_ID, percent: 1.0 }],
  },
  {
    id: "acc-2",
    name: "Joint Savings",
    value: 200_000,
    subType: "taxable",
    owners: [
      { kind: "entity", entityId: TRUST_ID, percent: 1.0 },
    ],
  },
  {
    id: "acc-3",
    name: "Personal Checking",
    value: 50_000,
    owners: [{ kind: "family_member", familyMemberId: "fm-c", percent: 1.0 }],
  },
];

const liabilities: AssetsTabLiability[] = [
  {
    id: "liab-1",
    name: "Mortgage",
    balance: 120_000,
    owners: [{ kind: "entity", entityId: TRUST_ID, percent: 1.0 }],
  },
  {
    id: "liab-2",
    name: "Car Loan",
    balance: 20_000,
    owners: [{ kind: "family_member", familyMemberId: "fm-c", percent: 1.0 }],
  },
];

const incomes: AssetsTabIncome[] = [
  { id: "inc-1", name: "Rental Income", annualAmount: 36_000, cashAccountId: "acc-1" },
  { id: "inc-2", name: "Salary", annualAmount: 120_000, cashAccountId: "personal-checking-not-in-trust" },
];

const expenses: AssetsTabExpense[] = [
  { id: "exp-1", name: "Property Tax", annualAmount: 5_000, cashAccountId: "acc-1" },
];

const familyMembers: AssetsTabFamilyMember[] = [
  { id: "fm-c", role: "client", firstName: "Alice" },
  { id: "fm-s", role: "spouse", firstName: "Bob" },
];

const entities = [{ id: TRUST_ID, name: "Family Trust" }];

describe("AssetsTab", () => {
  it("renders trust-owned accounts and liabilities", () => {
    render(
      <AssetsTab
        entityId={TRUST_ID}
        accounts={accounts}
        liabilities={liabilities}
        incomes={incomes}
        expenses={expenses}
        familyMembers={familyMembers}
        entities={entities}
        onChange={vi.fn()}
      />
    );
    expect(screen.getByText("Brokerage Account")).toBeInTheDocument();
    expect(screen.getByText("Joint Savings")).toBeInTheDocument();
    expect(screen.getByText("Mortgage")).toBeInTheDocument();
    // Personal Checking is not trust-owned — should not appear in the list
    expect(screen.queryByText("Personal Checking")).not.toBeInTheDocument();
  });

  it("shows correct total trust value (250k + 200k - 120k = 330k)", () => {
    render(
      <AssetsTab
        entityId={TRUST_ID}
        accounts={accounts}
        liabilities={liabilities}
        incomes={[]}
        expenses={[]}
        familyMembers={familyMembers}
        entities={entities}
        onChange={vi.fn()}
      />
    );
    // $330,000 formatted
    expect(screen.getByText("$330,000")).toBeInTheDocument();
  });

  it("shows read-only income panel filtered to trust asset ids only", () => {
    render(
      <AssetsTab
        entityId={TRUST_ID}
        accounts={accounts}
        liabilities={liabilities}
        incomes={incomes}
        expenses={expenses}
        familyMembers={familyMembers}
        entities={entities}
        onChange={vi.fn()}
      />
    );
    expect(screen.getByText("Rental Income")).toBeInTheDocument();
    expect(screen.getByText("Property Tax")).toBeInTheDocument();
    // Salary is linked to a non-trust account — should not appear
    expect(screen.queryByText("Salary")).not.toBeInTheDocument();
  });

  it("remove button opens confirmation dialog, confirm triggers onChange with remove op", () => {
    const onChange = vi.fn();
    render(
      <AssetsTab
        entityId={TRUST_ID}
        accounts={accounts}
        liabilities={liabilities}
        incomes={[]}
        expenses={[]}
        familyMembers={familyMembers}
        entities={entities}
        onChange={onChange}
      />
    );
    // Click the remove button for "Brokerage Account"
    const removeButtons = screen.getAllByLabelText(/Remove .* from trust/i);
    fireEvent.click(removeButtons[0]);
    // Confirmation dialog should appear
    expect(screen.getByText(/Remove from this trust/i)).toBeInTheDocument();
    // Confirm
    fireEvent.click(screen.getByRole("button", { name: /^Remove$/i }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ type: "remove" })
    );
  });

  it("renders a Businesses section listing businesses owned by the trust", () => {
    const businesses: AssetsTabBusiness[] = [
      {
        id: "biz-1",
        name: "Test Bus",
        value: 280_000,
        owners: [{ kind: "entity", entityId: TRUST_ID, percent: 1.0 }],
      },
      {
        id: "biz-2",
        name: "Sibling LLC",
        value: 100_000,
        // Not owned by this trust — should not appear in the trust's Assets tab.
        owners: [{ kind: "family_member", familyMemberId: "fm-c", percent: 1.0 }],
      },
    ];
    render(
      <AssetsTab
        entityId={TRUST_ID}
        accounts={accounts}
        liabilities={liabilities}
        incomes={[]}
        expenses={[]}
        familyMembers={familyMembers}
        entities={entities}
        businesses={businesses}
        onChange={vi.fn()}
      />
    );
    // Trust-owned business appears under Businesses
    expect(screen.getByText("Businesses")).toBeInTheDocument();
    expect(screen.getByText("Test Bus")).toBeInTheDocument();
    // Other business doesn't show on the trust card.
    expect(screen.queryByText("Sibling LLC")).not.toBeInTheDocument();
    // Total trust value rolls in 100% of the business's flat valuation
    //   trust accounts 250k + 200k − mortgage 120k + business 280k = 610k
    expect(screen.getByText("$610,000")).toBeInTheDocument();
  });

  it("clicking the X on a Business dispatches a remove op for assetType=entity", () => {
    const onChange = vi.fn();
    const businesses: AssetsTabBusiness[] = [
      {
        id: "biz-1",
        name: "Test Bus",
        value: 280_000,
        owners: [{ kind: "entity", entityId: TRUST_ID, percent: 1.0 }],
      },
    ];
    render(
      <AssetsTab
        entityId={TRUST_ID}
        accounts={accounts}
        liabilities={liabilities}
        incomes={[]}
        expenses={[]}
        familyMembers={familyMembers}
        entities={entities}
        businesses={businesses}
        onChange={onChange}
      />
    );
    fireEvent.click(screen.getByLabelText(/Remove Test Bus from trust/i));
    // Confirmation dialog
    fireEvent.click(screen.getByRole("button", { name: /^Remove$/i }));
    expect(onChange).toHaveBeenCalledWith({
      type: "remove",
      assetType: "entity",
      assetId: "biz-1",
    });
  });

  it("rolls held accounts + liabilities into the displayed business value (matches balance-sheet rollup)", () => {
    const TEST_BUS_ID = "biz-1";
    // Test Bus holds a brokerage worth $100k + a separate mortgage of $30k.
    // Trust holds Test Bus 100%, so the displayed business value should be
    // flat 280k + held 100k − mortgage 30k = 350k.
    const acctsWithBiz: AssetsTabAccount[] = [
      ...accounts,
      {
        id: "biz-broker",
        name: "Biz Brokerage",
        value: 100_000,
        owners: [{ kind: "entity", entityId: TEST_BUS_ID, percent: 1.0 }],
      },
    ];
    const liabsWithBiz: AssetsTabLiability[] = [
      ...liabilities,
      {
        id: "biz-mort",
        name: "Biz Mortgage",
        balance: 30_000,
        owners: [{ kind: "entity", entityId: TEST_BUS_ID, percent: 1.0 }],
      },
    ];
    const businesses: AssetsTabBusiness[] = [
      {
        id: TEST_BUS_ID,
        name: "Test Bus",
        value: 280_000,
        owners: [{ kind: "entity", entityId: TRUST_ID, percent: 1.0 }],
      },
    ];
    render(
      <AssetsTab
        entityId={TRUST_ID}
        accounts={acctsWithBiz}
        liabilities={liabsWithBiz}
        incomes={[]}
        expenses={[]}
        familyMembers={familyMembers}
        entities={entities}
        businesses={businesses}
        onChange={vi.fn()}
      />
    );
    // Business row displays the full balance-sheet value: 280 + 100 − 30 = 350k.
    expect(screen.getByText("$350,000")).toBeInTheDocument();
    // Net trust value: trust's own accounts 250 + 200 − mortgage 120 + business 350 = 680k.
    expect(screen.getByText("$680,000")).toBeInTheDocument();
  });

  it("shows empty state when no trust-owned items", () => {
    const unownedAccounts: AssetsTabAccount[] = [
      {
        id: "acc-x",
        name: "Solo Account",
        value: 100,
        owners: [{ kind: "family_member", familyMemberId: "fm-c", percent: 1.0 }],
      },
    ];
    render(
      <AssetsTab
        entityId={TRUST_ID}
        accounts={unownedAccounts}
        liabilities={[]}
        incomes={[]}
        expenses={[]}
        familyMembers={familyMembers}
        entities={entities}
        onChange={vi.fn()}
      />
    );
    expect(screen.getByText(/No assets assigned to this trust/i)).toBeInTheDocument();
  });
});
