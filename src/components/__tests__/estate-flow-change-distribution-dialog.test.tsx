// @vitest-environment jsdom
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import EstateFlowChangeDistributionDialog from "../estate-flow-change-distribution-dialog";
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
    client: { firstName: "Client", lastName: "Sample", spouseName: "Spouse Sample" },
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
      { id: "fm-spouse", role: "spouse", relationship: "child", firstName: "Spouse", lastName: "Sample" },
      { id: "fm-kid1", role: "child", relationship: "child", firstName: "Child", lastName: "Sample" },
      { id: "fm-kid2", role: "child", relationship: "child", firstName: "Second Child", lastName: "Sample" },
    ],
    externalBeneficiaries: [],
    entities: [],
    wills: [],
  } as unknown as ClientData;
}

describe("EstateFlowChangeDistributionDialog — Split among children", () => {
  it("creates one row per real child, not per household member", () => {
    render(
      <EstateFlowChangeDistributionDialog
        accountId="acc-1"
        clientData={householdData()}
        onApplyBeneficiaries={vi.fn()}
        onApplyWill={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    // Primary tier is rendered first; click its "Split among children".
    fireEvent.click(screen.getAllByRole("button", { name: /split among children/i })[0]);

    // Two children → two rows, not four (client + spouse must be excluded).
    expect(screen.getAllByLabelText("primary beneficiary")).toHaveLength(2);
  });
});
