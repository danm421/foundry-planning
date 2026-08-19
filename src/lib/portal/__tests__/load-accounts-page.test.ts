import { describe, it, expect, vi, beforeEach } from "vitest";

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
  accountHoldings: { _name: "accountHoldings" },
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
let mockNoScenario = false;
// One row per position; only the account id is selected.
let mockHoldings: { accountId: string }[] = [];
// The `clients` row the loader reads — edit switch plus the three feature switches.
let mockClientRow: Record<string, boolean> = {
  portalEditEnabled: true,
  portalInvestmentsEnabled: true,
  portalBudgetEnabled: true,
  portalDocumentsEnabled: true,
  portalCalculatorsEnabled: true,
};

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: (tbl: { _name: string }) => ({
        where: () => {
          if (tbl._name === "clients") {
            return { limit: () => Promise.resolve([mockClientRow]) };
          }
          if (tbl._name === "scenarios") {
            return { limit: () => Promise.resolve(mockNoScenario ? [] : [{ id: "scenario-base" }]) };
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
          if (tbl._name === "accountHoldings") {
            const rows = mockHoldings;
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
  mockNoScenario = false;
  mockHoldings = [];
  mockClientRow = {
    portalEditEnabled: true,
    portalInvestmentsEnabled: true,
    portalBudgetEnabled: true,
    portalDocumentsEnabled: true,
    portalCalculatorsEnabled: true,
  };
});

import { loadAccountsPage } from "../load-accounts-page";

describe("loadAccountsPage", () => {
  it("passes through portalEditEnabled", async () => {
    const dto = await loadAccountsPage("c1");
    expect(dto.editEnabled).toBe(true);
  });

  it("hides default-checking and advisor-only accounts", async () => {
    const dto = await loadAccountsPage("c1");
    // a1 (cash) + a2 (taxable) visible; a3 (isDefaultChecking) + a4 (notes_receivable) hidden.
    expect(dto.assets.map((a) => a.id)).toEqual(["a1", "a2"]);
    expect(dto.netWorth.assets).toBe(5100);
  });

  it("normalises accounts to the PortalAccountRow shape", async () => {
    const dto = await loadAccountsPage("c1");
    expect(dto.assets[1]).toMatchObject({
      id: "a2", name: "Brokerage", category: "taxable", subType: "brokerage",
      last4: "1234", value: 5000, isPlaidLinked: false,
    });
  });

  it("returns owners keyed by account id", async () => {
    const dto = await loadAccountsPage("c1");
    expect(dto.ownersByAccountId["a1"]).toEqual([
      { familyMemberId: "fm1", entityId: null, percent: "1" },
    ]);
    expect(dto.ownersByAccountId["a2"]).toHaveLength(1);
  });

  it("returns family members and trust entities for the owner pickers", async () => {
    const dto = await loadAccountsPage("c1");
    expect(dto.familyMembers).toHaveLength(1);
    expect(dto.trustEntities).toEqual([{ id: "ent1", name: "Pat Family Trust" }]);
  });

  it("nets debt out of net worth and carries debt metadata", async () => {
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

    const dto = await loadAccountsPage("client-1");
    expect(dto.netWorth).toEqual({ assets: 1000, debt: 250, netWorth: 750 });
    expect(dto.debts[0]).toMatchObject({ id: "lib1", liabilityType: "credit_card", aprPercentage: 19.99 });
  });

  it("flags the accounts holding a position, de-duped, so the drawer can offer a Holdings tab", async () => {
    mockHoldings = [{ accountId: "a2" }, { accountId: "a2" }];
    const dto = await loadAccountsPage("c1");
    expect(dto.holdingsAccountIds).toEqual(["a2"]);
  });

  it("flags nothing when the advisor has switched Investments off", async () => {
    // Same positions — the switch, not the data, is what empties the list. The
    // tab and the route it reads are gated together.
    mockHoldings = [{ accountId: "a2" }];
    mockClientRow = { ...mockClientRow, portalInvestmentsEnabled: false };
    const dto = await loadAccountsPage("c1");
    expect(dto.holdingsAccountIds).toEqual([]);
  });

  it("returns an empty DTO when the client has no base scenario", async () => {
    mockNoScenario = true;
    const dto = await loadAccountsPage("c1");
    expect(dto.assets).toEqual([]);
    expect(dto.debts).toEqual([]);
    expect(dto.netWorth).toEqual({ assets: 0, debt: 0, netWorth: 0 });
    expect(dto.holdingsAccountIds).toEqual([]);
  });
});
