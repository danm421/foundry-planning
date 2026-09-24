import { describe, it, expect, vi } from "vitest";
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
      { id: FM_SPOUSE, firstName: "Robin", lastName: "Test", relationship: "other", role: "spouse", dateOfBirth: "1972-01-01" } satisfies FamilyMember,
      { id: FM_CHILD, firstName: "Child", lastName: "Test", relationship: "child", role: "child", dateOfBirth: "2005-01-01" } satisfies FamilyMember,
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

  it("reassigns trust slice to the co-client FM when the entity grantor is the co-client", () => {
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

describe("synthesizeNoPlanClientData — giftEvents", () => {
  it("drops giftEvents targeting trusts", () => {
    const tree = fixture();
    tree.giftEvents = [
      { kind: "asset", year: 2027, accountId: "acc-1", percent: 0.4,
        grantor: "client", recipientEntityId: TRUST_SLAT },
      { kind: "asset", year: 2027, accountId: "acc-1", percent: 0.1,
        grantor: "client", recipientFamilyMemberId: FM_CHILD },
    ] as ClientData["giftEvents"];
    const result = synthesizeNoPlanClientData(tree);
    // The trust-directed event is gone; the gift to a person survives, exactly
    // as `gifts` already behaves — those happen in any plan.
    expect(result.giftEvents).toHaveLength(1);
    expect(result.giftEvents[0]).toMatchObject({ recipientFamilyMemberId: FM_CHILD });
  });

  it("keeps cash giftEvents to people and charities", () => {
    const tree = fixture();
    tree.giftEvents = [
      { kind: "cash", year: 2027, amount: 20_000, grantor: "client",
        recipientFamilyMemberId: FM_CHILD, useCrummeyPowers: false },
      { kind: "cash", year: 2027, amount: 30_000, grantor: "client",
        recipientEntityId: TRUST_SLAT, useCrummeyPowers: true },
    ] as ClientData["giftEvents"];
    const result = synthesizeNoPlanClientData(tree);
    expect(result.giftEvents).toHaveLength(1);
    expect(result.giftEvents[0]).toMatchObject({ amount: 20_000 });
  });

  it("drops a business_interest event whose recipient is a trust", () => {
    const tree = fixture();
    tree.giftEvents = [
      { kind: "business_interest", year: 2027, entityId: "biz-1", percent: 0.3,
        grantor: "client", recipientEntityId: TRUST_SLAT },
    ] as ClientData["giftEvents"];
    expect(synthesizeNoPlanClientData(tree).giftEvents).toEqual([]);
  });
});

describe("synthesizeNoPlanClientData — third-party-grantor trust", () => {
  function thirdPartyFixture(): ClientData {
    const tree = fixture();
    // A trust with no resolvable grantor — `grantor` is nullable in the schema.
    tree.entities = [
      { id: TRUST_SLAT, name: "Third-party SLAT", entityType: "trust",
        isIrrevocable: true, isGrantor: false, includeInPortfolio: false,
        grantor: null } as unknown as NonNullable<ClientData["entities"]>[number],
    ];
    return tree;
  }

  it("keeps the authored entity owner row instead of dropping the slice", () => {
    const result = synthesizeNoPlanClientData(thirdPartyFixture());
    expect(result.accounts[0].owners).toEqual([
      { kind: "family_member", familyMemberId: FM_CLIENT, percent: 0.6 },
      { kind: "entity", entityId: TRUST_SLAT, percent: 0.4 },
    ]);
  });

  it("leaves owners summing to exactly 1 so downstream reads cannot throw", () => {
    const result = synthesizeNoPlanClientData(thirdPartyFixture());
    const total = result.accounts[0].owners.reduce((s, o) => s + o.percent, 0);
    expect(total).toBeCloseTo(1, 9);
  });

  it("does NOT re-normalize the surviving owners to 1", () => {
    // Re-normalizing would push the client to 1.0 and silently hand a third
    // party's slice to the household. The client's authored 0.6 must stand.
    const result = synthesizeNoPlanClientData(thirdPartyFixture());
    const client = result.accounts[0].owners.find(
      (o) => o.kind === "family_member",
    );
    expect(client?.percent).toBe(0.6);
  });

  it("warns once per unresolved trust", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    synthesizeNoPlanClientData(thirdPartyFixture());
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain(TRUST_SLAT);
    warn.mockRestore();
  });

  it("still reassigns a trust whose grantor DOES resolve", () => {
    // The existing behavior must not regress — this is the happy path.
    const result = synthesizeNoPlanClientData(fixture());
    expect(result.accounts[0].owners).toEqual([
      { kind: "family_member", familyMemberId: FM_CLIENT, percent: 1.0 },
    ]);
  });
});
