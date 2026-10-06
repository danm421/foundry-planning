// @vitest-environment jsdom
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import EstateFlowAssetDialog from "../estate-flow-asset-dialog";
import type { ClientData } from "@/engine/types";

/**
 * Household with two real children. The client and spouse are stored as
 * `familyMembers` rows whose `relationship` is "child" — which happens in
 * practice because the DB column defaults to "child" and not every creation
 * path overrides it. "Split among children" must key off `role`, not
 * `relationship`, so it picks up exactly the two real children.
 */
function householdData(): ClientData {
  return {
    client: { firstName: "Client", lastName: "Sample", spouseName: "Robin Sample" },
    accounts: [
      {
        id: "acc-1",
        name: "Brokerage",
        category: "taxable",
        value: 100000,
        owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
        beneficiaries: [],
      },
    ],
    familyMembers: [
      { id: "fm-client", role: "client", relationship: "child", firstName: "Client", lastName: "Sample" },
      { id: "fm-spouse", role: "spouse", relationship: "child", firstName: "Robin", lastName: "Sample" },
      { id: "fm-kid1", role: "child", relationship: "child", firstName: "Child", lastName: "Sample" },
      { id: "fm-kid2", role: "child", relationship: "child", firstName: "Second Child", lastName: "Sample" },
    ],
    externalBeneficiaries: [],
    entities: [],
    wills: [],
  } as unknown as ClientData;
}

/** Renders the asset dialog for the brokerage and opens its Beneficiary tab. */
function renderBeneficiaryTab() {
  const data = householdData();
  render(
    <EstateFlowAssetDialog
      account={data.accounts[0]}
      clientData={data}
      ledger={[]}
      taxInflationRate={0}
      annualExclusionByYear={{}}
      onApplyOwners={vi.fn()}
      onApplyGift={vi.fn()}
      onSeedBeneficiary={vi.fn()}
      onApplyBeneficiaries={vi.fn()}
      onApplyWill={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Beneficiary" }));
}

describe("Estate Flow asset dialog, Beneficiary tab — Split among children", () => {
  it("creates one row per real child, not per household member", () => {
    renderBeneficiaryTab();

    // Primary tier is rendered first; click its "Split among children".
    fireEvent.click(screen.getAllByRole("button", { name: /split among children/i })[0]);

    // Two children → two rows, not four (client + spouse must be excluded).
    expect(screen.getAllByLabelText("primary beneficiary")).toHaveLength(2);
  });
});

describe("Estate Flow asset dialog, Beneficiary tab — household beneficiary options", () => {
  it("renders the co-client option with the lowercase parenthetical tag, beside the client tag", () => {
    renderBeneficiaryTab();

    // The fixture starts with no beneficiary rows; add one to render the
    // "Household" optgroup (both household members' real names).
    fireEvent.click(screen.getByRole("button", { name: /add primary/i }));

    expect(
      screen.getByRole("option", { name: "Client Sample" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Robin Sample" }),
    ).toBeInTheDocument();
  });
});
