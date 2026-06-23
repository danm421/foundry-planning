// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// Mock the client list component so we can read what props the section
// passed it without exercising its own logic.
vi.mock("../profile-accounts-list", () => ({
  default: ({ editEnabled, rows, familyMembers, trustEntities }: { editEnabled: boolean; rows: unknown[]; familyMembers: unknown[]; trustEntities: unknown[] }) => (
    <div
      data-testid="accounts-list"
      data-edit={String(editEnabled)}
      data-row-count={rows.length}
      data-fm-count={familyMembers.length}
      data-trust-count={trustEntities.length}
    />
  ),
}));

// Mock the chart component (client component; uses canvas which is unavailable in jsdom).
vi.mock("../networth-trend-chart", () => ({
  NetWorthTrendChart: () => null,
}));

// Each schema-import access returns a unique sentinel so we can branch in db mock.
vi.mock("@/db/schema", () => ({
  accounts: { _name: "accounts" },
  accountOwners: { _name: "accountOwners" },
  clients: { _name: "clients" },
  familyMembers: { _name: "familyMembers" },
  entities: { _name: "entities" },
  scenarios: { _name: "scenarios" },
  liabilities: { _name: "liabilities" },
  liabilityOwners: { _name: "liabilityOwners" },
  plaidTransactions: { _name: "plaidTransactions" },
}));
vi.mock("drizzle-orm", () => ({ and: (...a: unknown[]) => a, eq: (...a: unknown[]) => a, inArray: (...a: unknown[]) => a }));

// ---------- configurable mock state ----------
// Default rows match the original Phase-1 fixture.
let mockAccounts = [
  { id: "a1", name: "Checking", category: "cash", subType: "checking", value: "100.00", accountNumberLast4: null, plaidItemId: null, isDefaultChecking: false, parentAccountId: null },
  { id: "a2", name: "Brokerage", category: "taxable", subType: "brokerage", value: "5000.00", accountNumberLast4: "1234", plaidItemId: null, isDefaultChecking: false, parentAccountId: null },
  { id: "a3", name: "Household Cash", category: "cash", subType: "checking", value: "9999.00", accountNumberLast4: null, plaidItemId: null, isDefaultChecking: true, parentAccountId: null },
  { id: "a4", name: "Family Note", category: "notes_receivable", subType: "other", value: "25000.00", accountNumberLast4: null, plaidItemId: null, isDefaultChecking: false, parentAccountId: null },
];
let mockAccountOwners = [
  { accountId: "a1", familyMemberId: "fm1", entityId: null, percent: "1" },
  { accountId: "a2", familyMemberId: "fm1", entityId: null, percent: "1" },
];
let mockFamilyMembers: { id: string; firstName: string; lastName: string; role: string }[] = [
  { id: "fm1", firstName: "Pat", lastName: "Client", role: "client" },
];
let mockLiabilities: {
  id: string; name: string; balance: string; liabilityType: string | null;
  plaidItemId: string | null; plaidAccountId: string | null; minimumPayment: string | null;
  statementBalance: string | null; aprPercentage: string | null; nextPaymentDueDate: string | null;
}[] = [];
let mockLiabilityOwners: { liabilityId: string; familyMemberId: string | null; entityId: string | null; percent: string }[] = [];
let mockPlaidTransactions: unknown[] = [];

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: (tbl: { _name: string }) => ({
        where: () => {
          if (tbl._name === "clients") {
            return { limit: () => Promise.resolve([{ portalEditEnabled: true }]) };
          }
          if (tbl._name === "scenarios") {
            return { limit: () => Promise.resolve([{ id: "scenario-base" }]) };
          }
          if (tbl._name === "accounts") {
            const rows = mockAccounts;
            return { then: (resolve: (v: unknown) => unknown) => resolve(rows) };
          }
          if (tbl._name === "accountOwners") {
            const rows = mockAccountOwners;
            return { then: (resolve: (v: unknown) => unknown) => resolve(rows) };
          }
          if (tbl._name === "familyMembers") {
            const rows = mockFamilyMembers;
            return { then: (resolve: (v: unknown) => unknown) => resolve(rows) };
          }
          if (tbl._name === "entities") {
            const rows = [{ id: "ent1", name: "Pat Family Trust" }];
            return { then: (resolve: (v: unknown) => unknown) => resolve(rows) };
          }
          if (tbl._name === "liabilities") {
            const rows = mockLiabilities;
            return { then: (resolve: (v: unknown) => unknown) => resolve(rows) };
          }
          if (tbl._name === "liabilityOwners") {
            const rows = mockLiabilityOwners;
            return { then: (resolve: (v: unknown) => unknown) => resolve(rows) };
          }
          if (tbl._name === "plaidTransactions") {
            const rows = mockPlaidTransactions;
            return { then: (resolve: (v: unknown) => unknown) => resolve(rows) };
          }
          return { then: (resolve: (v: unknown) => unknown) => resolve([]) };
        },
      }),
    }),
  },
}));

beforeEach(() => {
  // Reset to Phase-1 defaults before each test.
  mockAccounts = [
    { id: "a1", name: "Checking", category: "cash", subType: "checking", value: "100.00", accountNumberLast4: null, plaidItemId: null, isDefaultChecking: false, parentAccountId: null },
    { id: "a2", name: "Brokerage", category: "taxable", subType: "brokerage", value: "5000.00", accountNumberLast4: "1234", plaidItemId: null, isDefaultChecking: false, parentAccountId: null },
    { id: "a3", name: "Household Cash", category: "cash", subType: "checking", value: "9999.00", accountNumberLast4: null, plaidItemId: null, isDefaultChecking: true, parentAccountId: null },
    { id: "a4", name: "Family Note", category: "notes_receivable", subType: "other", value: "25000.00", accountNumberLast4: null, plaidItemId: null, isDefaultChecking: false, parentAccountId: null },
  ];
  mockAccountOwners = [
    { accountId: "a1", familyMemberId: "fm1", entityId: null, percent: "1" },
    { accountId: "a2", familyMemberId: "fm1", entityId: null, percent: "1" },
  ];
  mockFamilyMembers = [{ id: "fm1", firstName: "Pat", lastName: "Client", role: "client" }];
  mockLiabilities = [];
  mockLiabilityOwners = [];
  mockPlaidTransactions = [];
});

import AccountsSection from "../accounts-section";

describe("AccountsSection", () => {
  it("editEnabled follows portalEditEnabled (toggle on → edit)", async () => {
    const ui = await AccountsSection({ clientId: "c1" });
    const { container } = render(ui);
    const list = container.querySelector("[data-testid='accounts-list']")!;
    expect(list.getAttribute("data-edit")).toBe("true");
    expect(list.getAttribute("data-row-count")).toBe("2");
    expect(list.getAttribute("data-fm-count")).toBe("1");
    expect(list.getAttribute("data-trust-count")).toBe("1");
  });

  it("hides default-checking + advisor-only accounts and totals only visible assets", async () => {
    const ui = await AccountsSection({ clientId: "c1" });
    const { container } = render(ui);
    const list = container.querySelector("[data-testid='accounts-list']")!;
    // a1 (cash) + a2 (taxable) visible; a3 (isDefaultChecking) + a4 (notes_receivable) hidden.
    expect(list.getAttribute("data-row-count")).toBe("2");
    // PortalNetWorthHeader renders "Assets" (no debt in default fixture → netWorth = assets).
    expect(container.textContent).toContain("Assets");
    expect(container.textContent).toContain("$5,100");
  });

  it("renders the net-worth header and a debt row with APR metadata", async () => {
    // Arrange: 1 visible cash account value 1000; 1 client-owned credit_card
    // liability balance 250 with aprPercentage 19.99; family member role "client";
    // no transactions.
    mockAccounts = [
      { id: "b1", name: "Savings", category: "cash", subType: "checking", value: "1000.00", accountNumberLast4: null, plaidItemId: null, isDefaultChecking: false, parentAccountId: null },
    ];
    mockAccountOwners = [{ accountId: "b1", familyMemberId: "fm1", entityId: null, percent: "1" }];
    mockFamilyMembers = [{ id: "fm1", firstName: "Pat", lastName: "Client", role: "client" }];
    mockLiabilities = [
      {
        id: "lib1", name: "Visa", balance: "250.00", liabilityType: "credit_card",
        plaidItemId: "plaid-item-1", plaidAccountId: "plaid-acc-1",
        minimumPayment: "25.00", statementBalance: null, aprPercentage: "19.99",
        nextPaymentDueDate: null,
      },
    ];
    mockLiabilityOwners = [
      { liabilityId: "lib1", familyMemberId: "fm1", entityId: null, percent: "1" },
    ];

    const ui = await AccountsSection({ clientId: "client-1" });
    const { container } = render(ui);
    expect(container.textContent).toContain("Net worth");
    expect(container.textContent).toContain("$750");
    expect(container.textContent).toMatch(/19\.99%/);
  });
});
