// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import EstateFlowChangeDistributionDialog from "./estate-flow-change-distribution-dialog";
import type { ClientData } from "@/engine/types";

function clientData(over: Partial<ClientData> = {}): ClientData {
  return {
    client: { firstName: "Pat", lastName: "Smith", spouseName: "Sam" },
    familyMembers: [
      { id: "fm-client", role: "client", relationship: "other", firstName: "Pat" },
      { id: "fm-spouse", role: "spouse", relationship: "other", firstName: "Sam" },
    ],
    accounts: [],
    entities: [],
    wills: [],
    externalBeneficiaries: [],
    ...over,
  } as unknown as ClientData;
}

function realEstateAccount() {
  return {
    id: "acc-house", name: "Family Home", category: "real_estate",
    subType: "primary_residence", value: 600_000, basis: 400_000, growthRate: 0.03,
    rmdEnabled: false,
    owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
  };
}

describe("EstateFlowChangeDistributionDialog — Part B (bequest-only)", () => {
  it("disables the Beneficiary Designation tab for a real-estate account", () => {
    render(
      <EstateFlowChangeDistributionDialog
        accountId="acc-house"
        clientData={clientData({ accounts: [realEstateAccount()] as never })}
        onApplyBeneficiaries={() => {}}
        onApplyWill={() => {}}
        onClose={() => {}}
      />,
    );
    const benefTab = screen.getByRole("tab", { name: /Beneficiary Designation/i });
    expect(benefTab).toBeDisabled();
    const willTab = screen.getByRole("tab", { name: /Will Bequest/i });
    expect(willTab).toHaveAttribute("aria-selected", "true");
  });
});
