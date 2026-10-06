// @vitest-environment jsdom
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import EstateFlowAssetDialog from "../estate-flow-asset-dialog";
import type { Account, ClientData } from "@/engine/types";

function clientData(accounts: unknown[]): ClientData {
  return {
    client: { firstName: "Pat", lastName: "Smith", spouseName: "Sam" },
    familyMembers: [
      { id: "fm-client", role: "client", relationship: "other", firstName: "Pat" },
      { id: "fm-spouse", role: "spouse", relationship: "other", firstName: "Sam" },
      { id: "fm-kid1", role: "child", relationship: "child", firstName: "Ava", lastName: "Smith" },
      { id: "fm-kid2", role: "child", relationship: "child", firstName: "Ben", lastName: "Smith" },
    ],
    accounts,
    entities: [],
    wills: [],
    liabilities: [],
    externalBeneficiaries: [],
  } as unknown as ClientData;
}

function account(over: Record<string, unknown>): Account {
  return {
    id: "acc-1", name: "Brokerage", category: "taxable", subType: "brokerage",
    value: 200_000, basis: 150_000, growthRate: 0.05, rmdEnabled: false,
    owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
    beneficiaries: [],
    ...over,
  } as unknown as Account;
}

function renderDialog(acct: Account) {
  const handlers = {
    onApplyOwners: vi.fn(),
    onApplyGift: vi.fn(),
    onSeedBeneficiary: vi.fn(),
    onApplyBeneficiaries: vi.fn(),
    onApplyWill: vi.fn(),
    onClose: vi.fn(),
  };
  render(
    <EstateFlowAssetDialog
      account={acct}
      clientData={clientData([acct])}
      ledger={[]}
      taxInflationRate={0}
      annualExclusionByYear={{}}
      {...handlers}
    />,
  );
  return handlers;
}

const button = (name: string) => screen.getByRole("button", { name });

describe("EstateFlowAssetDialog — tabs", () => {
  it("opens on the Owner tab with all three tabs available for a taxable account", () => {
    renderDialog(account({}));
    expect(screen.getByText("New owner")).toBeInTheDocument();
    expect(button("Owner")).toBeEnabled();
    expect(button("Beneficiary")).toBeEnabled();
    expect(button("Bequest")).toBeEnabled();
  });

  it("disables Beneficiary for real estate — it passes only by will", () => {
    renderDialog(account({ category: "real_estate", subType: "primary_residence" }));
    expect(button("Beneficiary")).toBeDisabled();
    expect(button("Bequest")).toBeEnabled();
  });

  it("disables Bequest for a retirement account — it passes only by designation", () => {
    renderDialog(account({ category: "retirement", subType: "traditional_ira" }));
    expect(button("Bequest")).toBeDisabled();
    expect(button("Beneficiary")).toBeEnabled();
  });

  it("shows both spouses' will editors on the Bequest tab for a joint asset", () => {
    renderDialog(
      account({
        owners: [
          { kind: "family_member", familyMemberId: "fm-client", percent: 0.5 },
          { kind: "family_member", familyMemberId: "fm-spouse", percent: 0.5 },
        ],
      }),
    );
    fireEvent.click(button("Bequest"));
    expect(screen.getByText(/Pat.*will/i)).toBeInTheDocument();
    expect(screen.getByText(/Sam.*will/i)).toBeInTheDocument();
  });
});

describe("EstateFlowAssetDialog — apply", () => {
  it("saves the owner change and closes", () => {
    const h = renderDialog(account({}));
    fireEvent.click(screen.getByRole("radio", { name: "Sam" }));
    fireEvent.click(button("Apply"));
    expect(h.onApplyOwners).toHaveBeenCalledWith([
      { kind: "family_member", familyMemberId: "fm-spouse", percent: 1 },
    ]);
    expect(h.onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps an unapplied owner choice across a tab switch", () => {
    renderDialog(account({}));
    fireEvent.click(screen.getByRole("radio", { name: "Sam" }));
    fireEvent.click(button("Beneficiary"));
    fireEvent.click(button("Owner"));
    expect(screen.getByRole("radio", { name: "Sam" })).toBeChecked();
  });

  it("saves beneficiaries and closes, keeping edits across a Bequest round trip", () => {
    const h = renderDialog(account({}));
    fireEvent.click(button("Beneficiary"));
    fireEvent.click(screen.getAllByRole("button", { name: /split among children/i })[0]);

    // The split survives a trip to the Bequest tab.
    fireEvent.click(button("Bequest"));
    fireEvent.click(button("Beneficiary"));
    expect(screen.getAllByLabelText("primary beneficiary")).toHaveLength(2);

    fireEvent.click(button("Apply"));
    expect(h.onApplyBeneficiaries).toHaveBeenCalledTimes(1);
    expect(h.onApplyBeneficiaries.mock.calls[0][0]).toMatchObject([
      { tier: "primary", percentage: 50, familyMemberId: "fm-kid1" },
      { tier: "primary", percentage: 50, familyMemberId: "fm-kid2" },
    ]);
    expect(h.onClose).toHaveBeenCalledTimes(1);
    expect(h.onApplyOwners).not.toHaveBeenCalled();
  });
});
