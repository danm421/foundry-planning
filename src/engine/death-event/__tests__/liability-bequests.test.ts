import { describe, it, expect } from "vitest";
import type {
  Will,
  Liability,
  FamilyMember,
  EntitySummary,
} from "../../types";
import { applyLiabilityBequests } from "../liability-bequests";

function baseLiability(overrides: Partial<Liability> = {}): Liability {
  return {
    id: "liab-1",
    name: "Visa CC",
    balance: 15_000,
    interestRate: 0.18,
    monthlyPayment: 300,
    startYear: 2020,
    startMonth: 1,
    termMonths: 120,
    extraPayments: [],
    ...overrides,
  };
}

function baseWill(bequests: Will["bequests"]): Will {
  return { id: "will-1", grantor: "client", bequests };
}

function baseFam(overrides: Partial<FamilyMember> = {}): FamilyMember {
  return {
    id: "fam-1",
    firstName: "Tom",
    lastName: "Jr.",
    relationship: "child",
    dateOfBirth: "2000-01-01",
    ...overrides,
  } as FamilyMember;
}

describe("applyLiabilityBequests — happy path", () => {
  it("100% bequest to single family_member: liability removed, new row created, one transfer at -balance", () => {
    const liab = baseLiability();
    const fam = baseFam();
    const will = baseWill([{
      id: "beq-1",
      name: "Visa",
      kind: "liability",
      assetMode: null,
      accountId: null,
      liabilityId: liab.id,
      percentage: 100,
      condition: "always",
      sortOrder: 0,
      recipients: [{
        recipientKind: "family_member",
        recipientId: fam.id,
        percentage: 100,
        sortOrder: 0,
      }],
    }]);

    const result = applyLiabilityBequests({
      will,
      deceased: "client",
      liabilities: [liab],
      familyMembers: [fam],
      entities: [] as EntitySummary[],
      year: 2050,
    });

    expect(result.updatedLiabilities).toHaveLength(0);
    expect(result.newLiabilityRows).toHaveLength(1);
    expect(result.newLiabilityRows[0]).toMatchObject({
      name: "Visa CC — bequest to Tom Jr.",
      balance: 15_000,
      monthlyPayment: 300,
      ownerFamilyMemberId: fam.id,
    });
    expect(result.bequestTransfers).toHaveLength(1);
    expect(result.bequestTransfers[0]).toMatchObject({
      year: 2050,
      deathOrder: 2,
      deceased: "client",
      via: "will_liability_bequest",
      sourceLiabilityId: liab.id,
      recipientKind: "family_member",
      recipientId: fam.id,
      amount: -15_000,
    });
    expect(result.warnings).toEqual([]);
  });
});
