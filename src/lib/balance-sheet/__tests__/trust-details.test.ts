// src/lib/balance-sheet/__tests__/trust-details.test.ts
import { describe, it, expect } from "vitest";
import type { ClientData } from "@/engine/types";
import { buildTrustDetails } from "../trust-details";

const labels = { clientLabel: "Cooper", spouseLabel: "Susan" };

const tree = {
  familyMembers: [
    { id: "fm-kid", role: "child", relationship: "child", firstName: "Emma", lastName: "Sample", dateOfBirth: null },
  ],
  externalBeneficiaries: [{ id: "xb-1", name: "Red Cross", kind: "charity", charityType: "public" }],
  entities: [
    {
      id: "t-ilit",
      name: "ILIT",
      entityType: "trust",
      includeInPortfolio: false,
      isGrantor: true,
      crummeyPowers: true,
      accessibleToClient: true,
      isIrrevocable: true,
      trustSubType: "ilit",
      trustee: "First National Bank",
      grantor: "client",
      beneficiaries: [
        { id: "b2", tier: "contingent", percentage: 100, externalBeneficiaryId: "xb-1", sortOrder: 0 },
        { id: "b1", tier: "primary", percentage: 60, familyMemberId: "fm-kid", sortOrder: 1 },
        { id: "b0", tier: "primary", percentage: 40, householdRole: "spouse", sortOrder: 0 },
      ],
    },
    {
      id: "t-bare",
      name: "Bare Trust",
      entityType: "trust",
      includeInPortfolio: false,
      isGrantor: false,
      beneficiaries: [{ id: "b3", tier: "primary", percentage: 100, entityIdRef: "t-ilit", sortOrder: 0 }],
      incomeBeneficiaries: [{ householdRole: "client", percentage: 100 }],
      remainderBeneficiaries: [{ familyMemberId: "fm-missing", percentage: 100, distributionForm: "outright" }],
    },
    { id: "e-llc", name: "Smith LLC", entityType: "llc", includeInPortfolio: false, isGrantor: false, value: 100 },
  ],
} as unknown as ClientData;

describe("buildTrustDetails", () => {
  const out = buildTrustDetails(tree, labels);
  const ilit = out.find((d) => d.entityId === "t-ilit")!;
  const bare = out.find((d) => d.entityId === "t-bare")!;

  it("returns only trusts", () => {
    expect(out.map((d) => d.entityId)).toEqual(["t-ilit", "t-bare"]);
  });

  it("carries trustee, subtype label, and resolved grantor", () => {
    expect(ilit.trustee).toBe("First National Bank");
    expect(ilit.subTypeLabel).toBe("ILIT");
    expect(ilit.grantor).toBe("Cooper");
    expect(bare.trustee).toBeNull();
    expect(bare.subTypeLabel).toBeNull();
    expect(bare.grantor).toBeNull();
  });

  it("assembles powers in a stable order", () => {
    expect(ilit.powers).toEqual(["Irrevocable", "Grantor trust", "Crummey powers", "Sprinkle"]);
    // isIrrevocable undefined → no revocability badge; false flags → no badges.
    expect(bare.powers).toEqual([]);
  });

  it("labels a revocable trust when isIrrevocable is explicitly false", () => {
    const rev = buildTrustDetails(
      { entities: [{ id: "t", entityType: "trust", includeInPortfolio: true, isGrantor: false, isIrrevocable: false }] } as unknown as ClientData,
      labels,
    );
    expect(rev[0].powers).toEqual(["Revocable"]);
  });

  it("resolves beneficiary names across ref kinds, grouped and sorted", () => {
    expect(ilit.beneficiaries).toEqual([
      { group: "Primary", name: "Susan", percentage: 40 },
      { group: "Primary", name: "Emma Sample", percentage: 60 },
      { group: "Contingent", name: "Red Cross", percentage: 100 },
    ]);
  });

  it("resolves entity refs, income beneficiaries, and flags unknown refs", () => {
    expect(bare.beneficiaries).toEqual([
      { group: "Primary", name: "ILIT", percentage: 100 },
      { group: "Income", name: "Cooper", percentage: 100 },
      { group: "Remainder", name: "(unknown beneficiary)", percentage: 100 },
    ]);
  });

  it("falls back to 'Spouse' when spouseLabel is null", () => {
    const out2 = buildTrustDetails(
      {
        entities: [
          {
            id: "t",
            entityType: "trust",
            includeInPortfolio: false,
            isGrantor: false,
            grantor: "spouse",
            beneficiaries: [{ id: "b", tier: "primary", percentage: 100, householdRole: "spouse", sortOrder: 0 }],
          },
        ],
      } as unknown as ClientData,
      { clientLabel: "Cooper", spouseLabel: null },
    );
    expect(out2[0].grantor).toBe("Spouse");
    expect(out2[0].beneficiaries[0].name).toBe("Spouse");
  });

  it("tolerates a missing entities array", () => {
    expect(buildTrustDetails({} as ClientData, labels)).toEqual([]);
  });
});
