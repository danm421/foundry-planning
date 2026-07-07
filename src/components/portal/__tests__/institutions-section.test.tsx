// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/db/schema", () => ({
  plaidItems: {
    id: {},
    clientId: {},
    institutionName: {},
    lastRefreshedAt: {},
    lastRefreshError: {},
    transactionsCursor: {},
    newAccountsAvailableAt: {},
    createdAt: {},
  },
}));

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () =>
            Promise.resolve([
              {
                id: "item-1",
                institutionName: "Chase",
                lastRefreshedAt: new Date(Date.now() - 2 * 3600_000),
                lastRefreshError: null,
                transactionsCursor: null,
                newAccountsAvailableAt: null,
              },
              {
                id: "item-2",
                institutionName: "Fidelity",
                lastRefreshedAt: null,
                lastRefreshError: "ITEM_LOGIN_REQUIRED",
                transactionsCursor: "cursor-abc",
                newAccountsAvailableAt: null,
              },
              {
                id: "item-3",
                institutionName: "Ally",
                lastRefreshedAt: new Date(Date.now() - 5 * 3600_000),
                lastRefreshError: "USER_PERMISSION_REVOKED",
                transactionsCursor: "cursor-def",
                newAccountsAvailableAt: null,
              },
              {
                id: "item-4",
                institutionName: "Schwab",
                lastRefreshedAt: new Date(Date.now() - 1 * 3600_000),
                lastRefreshError: null,
                transactionsCursor: "cursor-ghi",
                newAccountsAvailableAt: new Date(),
              },
            ]),
        }),
      }),
    }),
  },
}));

vi.mock("drizzle-orm", () => ({ eq: () => ({}), inArray: () => ({}) }));

// Mock the client component so we don't need to set up usePlaidLink / router
vi.mock("../institution-row", () => ({
  InstitutionRow: ({
    institutionName,
    statusLabel,
    needsTransactionsConsent,
    revoked,
    newAccountsAvailable,
  }: {
    institutionName: string;
    statusLabel: string;
    itemId: string;
    needsReauth: boolean;
    revoked: boolean;
    newAccountsAvailable: boolean;
    editEnabled: boolean;
    needsTransactionsConsent: boolean;
  }) => (
    <li
      data-needs-transactions-consent={String(needsTransactionsConsent)}
      data-revoked={String(revoked)}
      data-new-accounts-available={String(newAccountsAvailable)}
    >
      <span>{institutionName}</span>
      <span>{statusLabel}</span>
    </li>
  ),
}));

describe("InstitutionsSection", () => {
  it("renders one row per plaid item with appropriate status", async () => {
    const { InstitutionsSection } = await import("../institutions-section");
    render(await InstitutionsSection({ clientId: "client-1", editEnabled: true }));
    expect(screen.getByText("Chase")).toBeInTheDocument();
    expect(screen.getByText(/Last refreshed 2h ago|Last refreshed (less than an|about 2) hour/i)).toBeInTheDocument();
    expect(screen.getByText("Fidelity")).toBeInTheDocument();
    expect(screen.getByText(/Re-auth required/i)).toBeInTheDocument();
  });

  it("passes needsTransactionsConsent=true for null cursor, false for non-null", async () => {
    const { InstitutionsSection } = await import("../institutions-section");
    render(await InstitutionsSection({ clientId: "client-1", editEnabled: true }));
    // item-1 has transactionsCursor: null → needsTransactionsConsent should be true
    const chaseRow = screen.getByText("Chase").closest("li");
    expect(chaseRow).toHaveAttribute("data-needs-transactions-consent", "true");
    // item-2 has transactionsCursor: "cursor-abc" → needsTransactionsConsent should be false
    const fidelityRow = screen.getByText("Fidelity").closest("li");
    expect(fidelityRow).toHaveAttribute(
      "data-needs-transactions-consent",
      "false",
    );
  });

  it("revoked: a row with a REVOKED_CODES error renders Access revoked", async () => {
    const { InstitutionsSection } = await import("../institutions-section");
    render(await InstitutionsSection({ clientId: "client-1", editEnabled: true }));
    expect(screen.getByText("Ally")).toBeInTheDocument();
    expect(screen.getByText("Access revoked")).toBeInTheDocument();
    const allyRow = screen.getByText("Ally").closest("li");
    expect(allyRow).toHaveAttribute("data-revoked", "true");
  });

  it("newAccountsAvailable: passes true through when newAccountsAvailableAt is set", async () => {
    const { InstitutionsSection } = await import("../institutions-section");
    render(await InstitutionsSection({ clientId: "client-1", editEnabled: true }));
    const schwabRow = screen.getByText("Schwab").closest("li");
    expect(schwabRow).toHaveAttribute("data-new-accounts-available", "true");
    const chaseRow = screen.getByText("Chase").closest("li");
    expect(chaseRow).toHaveAttribute("data-new-accounts-available", "false");
  });
});
