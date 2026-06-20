// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import ProfileAccountsList from "../profile-accounts-list";

const BASE_ROW = {
  accountNumberLast4: null,
  plaidItemId: null,
  owners: [],
};

const rows = [
  { ...BASE_ROW, id: "1", name: "My Annuity Account", category: "annuity", subType: "other", value: "50000" },
  { ...BASE_ROW, id: "2", name: "My Stock Options", category: "stock_options", subType: "other", value: "25000" },
  { ...BASE_ROW, id: "3", name: "Mystery Future Account", category: "mystery_future_cat", subType: "other", value: "10000" },
];

describe("ProfileAccountsList", () => {
  it("renders annuity and stock_options accounts and their category headings", () => {
    const { container } = render(
      <ProfileAccountsList
        editEnabled={false}
        familyMembers={[]}
        trustEntities={[]}
        rows={rows}
      />,
    );

    // All three account names must appear — none silently dropped
    expect(container.textContent).toContain("My Annuity Account");
    expect(container.textContent).toContain("My Stock Options");
    expect(container.textContent).toContain("Mystery Future Account");

    // Category headings for the two newly-added categories must render
    expect(container.textContent).toContain("Annuity");
    expect(container.textContent).toContain("Stock options");
  });

  it("shows Plaid badge on Plaid-linked accounts and not on manual accounts", () => {
    const plaidRow = { ...BASE_ROW, id: "p1", name: "Chase Checking", category: "cash", subType: "checking", value: "5000", plaidItemId: "plaid-item-abc" };
    const manualRow = { ...BASE_ROW, id: "m1", name: "Manual Savings", category: "cash", subType: "savings", value: "2000" };
    const { container } = render(
      <ProfileAccountsList
        editEnabled={false}
        familyMembers={[]}
        trustEntities={[]}
        rows={[plaidRow, manualRow]}
      />,
    );
    // Plaid badge must appear once (for the linked account)
    const badges = container.querySelectorAll('[class*="bg-accent/10"]');
    expect(badges.length).toBe(1);
    expect(badges[0].textContent).toBe("Plaid");
  });

  it("hides Edit and Delete buttons for Plaid-linked accounts even when editEnabled", () => {
    const plaidRow = { ...BASE_ROW, id: "p2", name: "Plaid Brokerage", category: "taxable", subType: "brokerage", value: "10000", plaidItemId: "plaid-item-xyz" };
    const manualRow = { ...BASE_ROW, id: "m2", name: "Manual IRA", category: "retirement", subType: "traditional_ira", value: "30000" };
    const { getByText, queryAllByText } = render(
      <ProfileAccountsList
        editEnabled={true}
        familyMembers={[]}
        trustEntities={[]}
        rows={[plaidRow, manualRow]}
      />,
    );
    // Only one Edit button — for the manual account
    const editButtons = queryAllByText("Edit");
    expect(editButtons.length).toBe(1);
    // Only one Delete button — for the manual account
    const deleteButtons = queryAllByText("Delete");
    expect(deleteButtons.length).toBe(1);
    // Manual account name is still rendered
    expect(getByText("Manual IRA")).toBeTruthy();
    // Plaid account name is still rendered
    expect(getByText("Plaid Brokerage")).toBeTruthy();
  });
});
