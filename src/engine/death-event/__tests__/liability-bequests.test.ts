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

describe("applyLiabilityBequests — partial bequest", () => {
  it("60% bequest reduces balance/payment proportionally; one transfer at -0.6*balance", () => {
    const liab = baseLiability({ balance: 10_000, monthlyPayment: 200 });
    const fam = baseFam();
    const will = baseWill([{
      id: "beq-1", name: "Visa", kind: "liability", assetMode: null, accountId: null,
      liabilityId: liab.id, percentage: 100, condition: "always", sortOrder: 0,
      recipients: [{ recipientKind: "family_member", recipientId: fam.id, percentage: 60, sortOrder: 0 }],
    }]);

    const result = applyLiabilityBequests({
      will, deceased: "client", liabilities: [liab], familyMembers: [fam], entities: [], year: 2050,
    });

    expect(result.updatedLiabilities).toHaveLength(1);
    expect(result.updatedLiabilities[0]).toMatchObject({
      id: liab.id,
      balance: 4_000,
      monthlyPayment: 80,
    });
    expect(result.newLiabilityRows).toHaveLength(1);
    expect(result.newLiabilityRows[0]).toMatchObject({ balance: 6_000, monthlyPayment: 120 });
    expect(result.bequestTransfers).toHaveLength(1);
    expect(result.bequestTransfers[0].amount).toBe(-6_000);
  });
});

describe("applyLiabilityBequests — multi-recipient split", () => {
  it("two family_members at 50/50: two new rows, two transfers, balances sum to original", () => {
    const liab = baseLiability({ balance: 10_000 });
    const fam1 = baseFam({ id: "fam-1", firstName: "Tom", lastName: "Jr." });
    const fam2 = baseFam({ id: "fam-2", firstName: "Sarah", lastName: null });
    const will = baseWill([{
      id: "beq-1", name: "Visa", kind: "liability", assetMode: null, accountId: null,
      liabilityId: liab.id, percentage: 100, condition: "always", sortOrder: 0,
      recipients: [
        { recipientKind: "family_member", recipientId: fam1.id, percentage: 50, sortOrder: 0 },
        { recipientKind: "family_member", recipientId: fam2.id, percentage: 50, sortOrder: 1 },
      ],
    }]);

    const result = applyLiabilityBequests({
      will, deceased: "client", liabilities: [liab], familyMembers: [fam1, fam2], entities: [], year: 2050,
    });

    expect(result.updatedLiabilities).toHaveLength(0);
    expect(result.newLiabilityRows).toHaveLength(2);
    expect(result.newLiabilityRows.map((r) => r.balance).reduce((a, b) => a + b, 0)).toBe(10_000);
    expect(result.bequestTransfers).toHaveLength(2);
    expect(result.bequestTransfers.map((t) => t.amount).reduce((a, b) => a + b, 0)).toBe(-10_000);
  });
});

describe("applyLiabilityBequests — entity recipient", () => {
  it("entity recipient → new liability row with ownerEntityId set; no ownerFamilyMemberId", () => {
    const liab = baseLiability();
    const entity: EntitySummary = {
      id: "ent-1",
      includeInPortfolio: false,
      isIrrevocable: false,
      isGrantor: true,
      grantor: "client",
      beneficiaries: [],
      exemptionConsumed: 0,
      trustSubType: "revocable",
    } as unknown as EntitySummary;
    const will = baseWill([{
      id: "beq-1", name: "Visa", kind: "liability", assetMode: null, accountId: null,
      liabilityId: liab.id, percentage: 100, condition: "always", sortOrder: 0,
      recipients: [{ recipientKind: "entity", recipientId: entity.id, percentage: 100, sortOrder: 0 }],
    }]);

    const result = applyLiabilityBequests({
      will, deceased: "client", liabilities: [liab], familyMembers: [], entities: [entity], year: 2050,
    });

    expect(result.newLiabilityRows).toHaveLength(1);
    expect(result.newLiabilityRows[0].ownerEntityId).toBe(entity.id);
    expect(result.newLiabilityRows[0].ownerFamilyMemberId).toBeUndefined();
    expect(result.bequestTransfers[0].recipientKind).toBe("entity");
  });
});
