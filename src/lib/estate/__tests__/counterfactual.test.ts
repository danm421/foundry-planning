import { describe, it, expect } from "vitest";
import { synthesizeNoPlanClientData } from "../counterfactual";
import { runProjection } from "@/engine/projection";
import type { ClientData, ClientInfo, FamilyMember, EntitySummary, Gift } from "@/engine/types";

const FM_CLIENT = "fm-client";
const FM_SPOUSE = "fm-spouse";
const FM_CHILD = "fm-child";
const TRUST_SLAT = "trust-slat";

function fixture(): ClientData {
  return {
    client: {
      firstName: "T",
      lastName: "C",
      dateOfBirth: "1970-01-01",
      retirementAge: 65,
      planEndAge: 88,
      filingStatus: "married_joint",
    } satisfies ClientInfo,
    accounts: [
      {
        id: "acc-1",
        name: "Brokerage A",
        category: "taxable",
        subType: "brokerage",
        value: 1_000_000,
        basis: 1_000_000,
        growthRate: 0,
        rmdEnabled: false,
        owners: [
          { kind: "family_member", familyMemberId: FM_CLIENT, percent: 0.6 },
          { kind: "entity", entityId: TRUST_SLAT, percent: 0.4 },
        ],
      } as unknown as ClientData["accounts"][number],
    ],
    entities: [
      {
        id: TRUST_SLAT,
        name: "SLAT",
        entityType: "trust",
        isIrrevocable: true,
        isGrantor: true,
        includeInPortfolio: false,
        grantor: "client",
      } satisfies EntitySummary,
    ],
    familyMembers: [
      { id: FM_CLIENT, firstName: "Client", lastName: "Test", relationship: "other", role: "client", dateOfBirth: "1970-01-01" } satisfies FamilyMember,
      { id: FM_SPOUSE, firstName: "Spouse", lastName: "Test", relationship: "other", role: "spouse", dateOfBirth: "1972-01-01" } satisfies FamilyMember,
      { id: FM_CHILD, firstName: "Child", lastName: "Test", relationship: "child", role: "dependent", dateOfBirth: "2005-01-01" } satisfies FamilyMember,
    ],
    gifts: [
      { id: "g1", year: 2026, amount: 100_000, grantor: "client", recipientEntityId: TRUST_SLAT, useCrummeyPowers: true } satisfies Gift,
      { id: "g2", year: 2026, amount: 50_000, grantor: "client", recipientFamilyMemberId: FM_CHILD, useCrummeyPowers: false } satisfies Gift,
    ],
    giftEvents: [],
    incomes: [],
    expenses: [],
    liabilities: [],
    savingsRules: [],
    withdrawalStrategy: [],
    deductions: [],
    transfers: [],
    assetTransactions: [],
    wills: [],
    externalBeneficiaries: [],
    planSettings: {
      flatFederalRate: 0,
      flatStateRate: 0,
      inflationRate: 0,
      planStartYear: 2026,
      planEndYear: 2030,
      taxEngineMode: "flat",
      taxInflationRate: 0.025,
      estateAdminExpenses: 0,
      flatStateEstateRate: 0,
    },
  } as ClientData;
}

describe("synthesizeNoPlanClientData", () => {
  it("reassigns trust-owned slices back to grantor family member", () => {
    const tree = fixture();
    const result = synthesizeNoPlanClientData(tree);
    const acc = result.accounts[0];
    expect(acc.owners).toEqual([
      { kind: "family_member", familyMemberId: FM_CLIENT, percent: 1.0 },
    ]);
  });

  it("drops gifts targeting trusts but keeps gifts to people", () => {
    const tree = fixture();
    const result = synthesizeNoPlanClientData(tree);
    const giftIds = (result.gifts ?? []).map((g) => g.id);
    expect(giftIds).toEqual(["g2"]);
  });

  it("preserves gifts to charities (not trust-related)", () => {
    const tree = fixture();
    tree.gifts = [
      ...(tree.gifts ?? []),
      { id: "g3", year: 2026, amount: 10_000, grantor: "client", recipientExternalBeneficiaryId: "charity-1", useCrummeyPowers: false },
    ];
    const result = synthesizeNoPlanClientData(tree);
    const giftIds = (result.gifts ?? []).map((g) => g.id);
    expect(giftIds).toContain("g3");
  });

  it("reassigns trust slice to spouse FM when entity.grantor is 'spouse'", () => {
    const tree = fixture();
    tree.entities![0].grantor = "spouse";
    const result = synthesizeNoPlanClientData(tree);
    // acc-1 had 0.6 FM_CLIENT + 0.4 SLAT; SLAT now reassigns to FM_SPOUSE.
    // Expect two owner rows after collapseOwners (different FMs don't merge).
    expect(result.accounts[0].owners).toEqual(
      expect.arrayContaining([
        { kind: "family_member", familyMemberId: FM_CLIENT, percent: 0.6 },
        { kind: "family_member", familyMemberId: FM_SPOUSE, percent: 0.4 },
      ]),
    );
    expect(result.accounts[0].owners.length).toBe(2);
  });
});

describe("synthesizeNoPlanClientData — round-trip with runProjection", () => {
  it("synthesized variant runs runProjection without trust-related warnings", () => {
    // Smoke test: verifies the synthesized variant doesn't fail through runProjection.
    // Full death-event warning coverage (trust_beneficiaries_incomplete and
    // trust_pour_out_fallback_fired) lives in plan-3a-integration.test.ts (Task 19,
    // Cooper-Sample fixture, which uses a 2026–2066 window that does hit death events).
    const tree = fixture();
    const synthesized = synthesizeNoPlanClientData(tree);
    const result = runProjection(synthesized);

    expect(result.length).toBeGreaterThan(0);

    const trustIds = new Set(
      (tree.entities ?? []).filter((e) => e.entityType === "trust").map((e) => e.id),
    );
    const offendingWarnings: string[] = [];
    for (const year of result) {
      for (const w of year.deathWarnings ?? []) {
        for (const id of trustIds) {
          if (w.includes(id)) offendingWarnings.push(`year ${year.year}: ${w}`);
        }
      }
      for (const w of year.trustWarnings ?? []) {
        for (const id of trustIds) {
          if ("entityId" in w && w.entityId === id) {
            offendingWarnings.push(`year ${year.year}: trust warning ${w.code} on ${id}`);
          }
        }
      }
    }
    expect(offendingWarnings).toEqual([]);
  });
});
