// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { PortalDebtRow } from "@/lib/portal/portal-networth";

const portalFetchMock = vi.fn();
vi.mock("@/components/portal/portal-mode-context", () => ({
  usePortalFetch: () => portalFetchMock,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { ProfileDebtList } from "../profile-debt-list";

const plaidRow: PortalDebtRow = {
  id: "l1", name: "Plaid Mortgage", balance: 56302, rawBalance: 56302, liabilityType: "mortgage",
  aprPercentage: 4.5, statementBalance: null, minimumPayment: 1200, nextPaymentDueDate: "2026-07-01",
  isPlaidLinked: true, ownerFmIds: [], ownerEntityIds: [],
};
const manualRow: PortalDebtRow = {
  id: "l2", name: "Auto Loan", balance: 12000, rawBalance: 12000, liabilityType: "auto",
  aprPercentage: null, statementBalance: null, minimumPayment: null, nextPaymentDueDate: null,
  isPlaidLinked: false, ownerFmIds: ["fmA"], ownerEntityIds: [],
};
const fms = [
  { id: "fmA", firstName: "Pat", lastName: "Lee", role: "client" },
  { id: "fmB", firstName: "Sam", lastName: "Lee", role: "spouse" },
];
const trusts = [{ id: "e1", name: "Lee Family Trust" }];

beforeEach(() => {
  portalFetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => ({}) });
});

describe("ProfileDebtList", () => {
  it("renders null when there are no debts", () => {
    const { container } = render(
      <ProfileDebtList rows={[]} familyMembers={fms} trustEntities={trusts} editEnabled />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows type label, Plaid APR, and owner name", () => {
    render(
      <ProfileDebtList rows={[plaidRow, manualRow]} familyMembers={fms} trustEntities={trusts} editEnabled={false} />,
    );
    expect(screen.getByText("Plaid Mortgage")).toBeInTheDocument();
    expect(screen.getByText("Auto Loan")).toBeInTheDocument();
    expect(screen.getByText(/4\.50% APR/)).toBeInTheDocument();
    expect(screen.getByText(/Pat Lee/)).toBeInTheDocument();
  });

  it("hides edit/delete controls when editing is disabled", () => {
    render(
      <ProfileDebtList rows={[manualRow]} familyMembers={fms} trustEntities={trusts} editEnabled={false} />,
    );
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("offers Delete only for manual debts, never for Plaid debts", () => {
    render(
      <ProfileDebtList rows={[plaidRow, manualRow]} familyMembers={fms} trustEntities={trusts} editEnabled />,
    );
    // Both rows get an Edit button…
    expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(2);
    // …but only the manual row gets a Delete button.
    expect(screen.getAllByRole("button", { name: "Delete" })).toHaveLength(1);
  });

  it("opens the edit form prefilled and locks balance for a Plaid debt", () => {
    render(
      <ProfileDebtList rows={[plaidRow]} familyMembers={fms} trustEntities={trusts} editEnabled />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByDisplayValue("Plaid Mortgage")).toBeInTheDocument();
    expect(screen.getByText(/Synced via Plaid/)).toBeInTheDocument();
    // Balance is read-only text, not a number input, when Plaid-locked.
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
  });

  it("DELETEs a manual debt through portalFetch", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(
      <ProfileDebtList rows={[manualRow]} familyMembers={fms} trustEntities={trusts} editEnabled />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(portalFetchMock).toHaveBeenCalledWith(
      "/api/portal/liabilities/l2",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});
