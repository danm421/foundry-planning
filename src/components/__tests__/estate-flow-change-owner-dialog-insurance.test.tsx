// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import EstateFlowChangeOwnerDialog from "@/components/estate-flow-change-owner-dialog";
import type { Account, ClientData } from "@/engine/types";

/**
 * Household with a real ILIT (irrevocable) and a revocable trust.
 *
 * The dialog renders one radio per destination. Switching the radio
 * for "Alice ILIT" toggles between gift-form mode (where Apply hides
 * and "Add gift" appears) and direct-retitle mode (where Apply stays
 * visible and onApply fires). That toggle is the behaviour under test.
 */
const clientData = {
  client: { firstName: "Alice", lastName: "Smith", spouseName: "Bob" },
  familyMembers: [
    { id: "fm-c", role: "client", relationship: "client", firstName: "Alice", lastName: "Smith" },
    { id: "fm-s", role: "spouse", relationship: "spouse", firstName: "Bob", lastName: "Smith" },
  ],
  entities: [
    { id: "rev-1", name: "Alice Revocable Trust", entityType: "trust", isIrrevocable: false },
    { id: "ilit-1", name: "Alice ILIT", entityType: "trust", isIrrevocable: true },
  ],
  accounts: [],
  wills: [],
  liabilities: [],
  externalBeneficiaries: [],
} as unknown as ClientData;

const insuranceAccount = {
  id: "pol-1",
  name: "Alice Term 20",
  category: "life_insurance",
  subType: "term",
  value: 0,
  basis: 0,
  growthRate: 0,
  rmdEnabled: false,
  owners: [{ kind: "family_member", familyMemberId: "fm-c", percent: 1 }],
  lifeInsurance: { faceValue: 1_000_000 },
} as unknown as Account;

const taxableAccount = {
  ...insuranceAccount,
  id: "tax-1",
  name: "Joint Brokerage",
  category: "taxable",
  subType: "brokerage",
  value: 250_000,
  lifeInsurance: undefined,
} as unknown as Account;

describe("EstateFlowChangeOwnerDialog — insurance + irrevocable trust", () => {
  it("retitles an insurance policy into an ILIT without invoking the gift handler", () => {
    const onApply = vi.fn();
    const onApplyGift = vi.fn();

    render(
      <EstateFlowChangeOwnerDialog
        account={insuranceAccount}
        clientData={clientData}
        onApply={onApply}
        onApplyGift={onApplyGift}
        ledger={[]}
        taxInflationRate={0}
        onClose={vi.fn()}
      />,
    );

    // Pick the ILIT as the new owner. Destinations render as <label>+<input
    // type="radio">; the accessible name of each radio is the destination label.
    fireEvent.click(screen.getByRole("radio", { name: /alice ilit/i }));

    // Gift-form should NOT appear: insurance-into-ILIT is direct retitling.
    // The gift form's "Recipient" label is unique to that subtree, so its
    // absence is a clean negative assertion.
    expect(screen.queryByText(/Recipient/)).toBeNull();
    // Primary action stays "Apply" (not "Add gift").
    expect(screen.queryByRole("button", { name: "Add gift" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(onApplyGift).not.toHaveBeenCalled();
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0][0]).toEqual([
      { kind: "entity", entityId: "ilit-1", percent: 1 },
    ]);
  });

  it("retitles a taxable account into an ILIT through the gift handler (regression)", () => {
    const onApply = vi.fn();
    const onApplyGift = vi.fn();

    render(
      <EstateFlowChangeOwnerDialog
        account={taxableAccount}
        clientData={clientData}
        onApply={onApply}
        onApplyGift={onApplyGift}
        ledger={[]}
        taxInflationRate={0}
        onClose={vi.fn()}
      />,
    );

    // Pick the ILIT — for a non-insurance account this must surface the gift form.
    fireEvent.click(screen.getByRole("radio", { name: /alice ilit/i }));

    // Gift-form is visible — its "Recipient" label is unique to that subtree.
    expect(screen.getByText("Recipient")).toBeDefined();
    // Primary action switches to "Add gift"; bare "Apply" is gone.
    expect(screen.getByRole("button", { name: "Add gift" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();

    // onApply must NOT fire on gift destinations — clicking "Add gift" with
    // no valid draft is a no-op, which is enough to assert the routing.
    fireEvent.click(screen.getByRole("button", { name: "Add gift" }));
    expect(onApply).not.toHaveBeenCalled();
  });
});
