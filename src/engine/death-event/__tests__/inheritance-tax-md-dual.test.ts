import { describe, it, expect } from "vitest";
import { computeInheritanceForDeathEvent } from "../inheritance-tax";
import type { Account, DeathTransfer, FamilyMember } from "@/engine/types";

function mkDeathTransfer(o: Partial<DeathTransfer> & {
  amount: number;
  recipientKind: DeathTransfer["recipientKind"];
  recipientId: string | null;
  recipientLabel: string;
}): DeathTransfer {
  return {
    year: 2026,
    deathOrder: 1,
    deceased: "client",
    sourceAccountId: null,
    sourceAccountName: null,
    sourceLiabilityId: null,
    sourceLiabilityName: null,
    via: "will",
    basis: 0,
    resultingAccountId: null,
    resultingLiabilityId: null,
    ...o,
  };
}

describe("MD dual estate + inheritance interaction — helper", () => {
  // Spec golden: gross $7M, MD estate preCapTax = ($7M - $5M) × 16% = $320,000.
  // Two Class B heirs each get $3.5M (friends, no exemption beyond $1K each).
  //   Each: ($3.5M - $1,000) × 10% = $349,900
  //   Inheritance total: $699,800
  it("computes per-recipient inheritance tax for two MD Class B heirs", () => {
    const heir1: FamilyMember = {
      id: "h1", role: "other", relationship: "other", firstName: "Friend",
      lastName: "One", dateOfBirth: "1970-01-01",
    };
    const heir2: FamilyMember = {
      id: "h2", role: "other", relationship: "other", firstName: "Friend",
      lastName: "Two", dateOfBirth: "1970-01-01",
    };

    const transfers: DeathTransfer[] = [
      mkDeathTransfer({
        amount: 3_500_000,
        recipientKind: "family_member",
        recipientId: "h1",
        recipientLabel: "Friend One",
      }),
      mkDeathTransfer({
        amount: 3_500_000,
        recipientKind: "family_member",
        recipientId: "h2",
        recipientLabel: "Friend Two",
      }),
    ];

    const result = computeInheritanceForDeathEvent({
      state: "MD",
      deathYear: 2026,
      decedentAge: 70,
      grossEstate: 7_000_000,
      transfers,
      accounts: [] as Account[],
      familyMembers: [heir1, heir2],
      externalBeneficiaries: [],
    });

    expect(result.totalTax).toBe(699_800);
    expect(result.perRecipient).toHaveLength(2);
    expect(result.perRecipient[0].classLabel).toBe("B");
    expect(result.perRecipient[0].tax).toBe(349_900);
    expect(result.perRecipient[1].tax).toBe(349_900);
  });

  it("estate floor: gross < $50K → zero inheritance tax", () => {
    const result = computeInheritanceForDeathEvent({
      state: "MD",
      deathYear: 2026,
      decedentAge: 70,
      grossEstate: 30_000,
      transfers: [
        mkDeathTransfer({
          amount: 30_000,
          recipientKind: "family_member",
          recipientId: "h1",
          recipientLabel: "Friend",
        }),
      ],
      accounts: [],
      familyMembers: [{
        id: "h1", role: "other", relationship: "other",
        firstName: "Friend", lastName: null, dateOfBirth: null,
      }],
      externalBeneficiaries: [],
    });
    expect(result.totalTax).toBe(0);
    expect(result.estateMinimumFloorApplied).toBe(true);
  });

  it("spouse transfer in PA → Class A, zero tax", () => {
    const result = computeInheritanceForDeathEvent({
      state: "PA",
      deathYear: 2026,
      decedentAge: 70,
      grossEstate: 2_000_000,
      transfers: [
        mkDeathTransfer({
          amount: 2_000_000,
          recipientKind: "spouse",
          recipientId: null,
          recipientLabel: "Spouse",
        }),
      ],
      accounts: [],
      familyMembers: [],
      externalBeneficiaries: [],
    });
    expect(result.totalTax).toBe(0);
    expect(result.perRecipient[0].classLabel).toBe("A");
    expect(result.perRecipient[0].classSource).toBe("spouse-role");
  });

  it("PA life-insurance excluded via Account.category", () => {
    const lifeIns: Account = {
      id: "acct-life", name: "Term policy", category: "life_insurance",
      subType: "term", value: 0, basis: 0, growthRate: 0, rmdEnabled: false,
    };
    const childMember: FamilyMember = {
      id: "child-1", role: "child", relationship: "child",
      firstName: "Kid", lastName: null, dateOfBirth: "1990-01-01",
    };
    const result = computeInheritanceForDeathEvent({
      state: "PA",
      deathYear: 2026,
      decedentAge: 65,
      grossEstate: 500_000,
      transfers: [
        mkDeathTransfer({
          amount: 500_000,
          recipientKind: "family_member",
          recipientId: "child-1",
          recipientLabel: "Kid",
          sourceAccountId: "acct-life",
          sourceAccountName: "Term policy",
        }),
      ],
      accounts: [lifeIns],
      familyMembers: [childMember],
      externalBeneficiaries: [],
    });
    expect(result.totalTax).toBe(0);
    expect(result.perRecipient[0].excluded).toBe(500_000);
    expect(result.perRecipient[0].excludedReasons[0]).toContain("life insurance");
  });
});
