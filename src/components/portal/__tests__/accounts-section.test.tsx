// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

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

// Each schema-import access returns a unique sentinel so we can branch in db mock.
vi.mock("@/db/schema", () => ({
  accounts: { _name: "accounts" },
  accountOwners: { _name: "accountOwners" },
  clients: { _name: "clients" },
  familyMembers: { _name: "familyMembers" },
  entities: { _name: "entities" },
  scenarios: { _name: "scenarios" },
}));
vi.mock("drizzle-orm", () => ({ and: (...a: unknown[]) => a, eq: (...a: unknown[]) => a, inArray: (...a: unknown[]) => a }));

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: (tbl: { _name: string }) => ({
        where: () => {
          if (tbl._name === "clients") {
            // .limit(1) chain — returns [{ portalEditEnabled }]
            return { limit: () => Promise.resolve([{ portalEditEnabled: true }]) };
          }
          if (tbl._name === "scenarios") {
            return { limit: () => Promise.resolve([{ id: "scenario-base" }]) };
          }
          if (tbl._name === "accounts") {
            // Awaited directly (array of rows) — return thenable.
            const rows = [
              { id: "a1", name: "Checking", category: "cash", subType: "checking", value: "100.00", accountNumberLast4: null, plaidItemId: null, isDefaultChecking: false, parentAccountId: null },
              { id: "a2", name: "Brokerage", category: "taxable", subType: "brokerage", value: "5000.00", accountNumberLast4: "1234", plaidItemId: null, isDefaultChecking: false, parentAccountId: null },
              { id: "a3", name: "Household Cash", category: "cash", subType: "checking", value: "9999.00", accountNumberLast4: null, plaidItemId: null, isDefaultChecking: true, parentAccountId: null },
              { id: "a4", name: "Family Note", category: "notes_receivable", subType: "other", value: "25000.00", accountNumberLast4: null, plaidItemId: null, isDefaultChecking: false, parentAccountId: null },
            ];
            return { then: (resolve: (v: unknown) => unknown) => resolve(rows) };
          }
          if (tbl._name === "accountOwners") {
            const rows = [
              { accountId: "a1", familyMemberId: "fm1", entityId: null, percent: "1" },
              { accountId: "a2", familyMemberId: "fm1", entityId: null, percent: "1" },
            ];
            return { then: (resolve: (v: unknown) => unknown) => resolve(rows) };
          }
          if (tbl._name === "familyMembers") {
            const rows = [{ id: "fm1", firstName: "Pat", lastName: "Client", role: "client" }];
            return { then: (resolve: (v: unknown) => unknown) => resolve(rows) };
          }
          if (tbl._name === "entities") {
            const rows = [{ id: "ent1", name: "Pat Family Trust" }];
            return { then: (resolve: (v: unknown) => unknown) => resolve(rows) };
          }
          return { then: (resolve: (v: unknown) => unknown) => resolve([]) };
        },
      }),
    }),
  },
}));

import AccountsSection from "../accounts-section";

describe("AccountsSection", () => {
  it("renders in read-only mode when previewing=true, even though portalEditEnabled is true", async () => {
    const ui = await AccountsSection({ clientId: "c1", previewing: true });
    const { container } = render(ui);
    const list = container.querySelector("[data-testid='accounts-list']")!;
    expect(list.getAttribute("data-edit")).toBe("false");
    expect(list.getAttribute("data-row-count")).toBe("2");
    expect(list.getAttribute("data-fm-count")).toBe("1");
    expect(list.getAttribute("data-trust-count")).toBe("1");
  });

  it("respects DB toggle when previewing is omitted", async () => {
    const ui = await AccountsSection({ clientId: "c1" });
    const { container } = render(ui);
    const list = container.querySelector("[data-testid='accounts-list']")!;
    expect(list.getAttribute("data-edit")).toBe("true");
  });

  it("hides default-checking + advisor-only accounts and totals only visible assets", async () => {
    const ui = await AccountsSection({ clientId: "c1" });
    const { container } = render(ui);
    const list = container.querySelector("[data-testid='accounts-list']")!;
    // a1 (cash) + a2 (taxable) visible; a3 (isDefaultChecking) + a4 (notes_receivable) hidden.
    expect(list.getAttribute("data-row-count")).toBe("2");
    expect(container.textContent).toContain("Total assets");
    expect(container.textContent).toContain("$5,100");
  });
});
