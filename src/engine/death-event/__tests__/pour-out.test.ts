import { describe, it, expect } from "vitest";
import { runPourOut } from "../shared";
import type { ExternalBeneficiarySummary } from "../shared";
import { giftAwareLiabilityOwners } from "../../ownership";
import type {
  Account,
  BeneficiaryRef,
  EntitySummary,
  FamilyMember,
  Liability,
} from "../../types";

function acct(id: string, owners: Account["owners"]): Account {
  return {
    id,
    name: id,
    category: "taxable",
    subType: "generic",
    value: 0,
    basis: 0,
    growthRate: 0,
    rmdEnabled: false,
    titlingType: "jtwros",
    owners,
  };
}

function liab(id: string, balance: number, owners: Liability["owners"]): Liability {
  return {
    id,
    name: id,
    balance,
    interestRate: 0,
    monthlyPayment: 0,
    startYear: 2025,
    startMonth: 1,
    termMonths: 0,
    extraPayments: [],
    owners,
  };
}

const FM_KID: FamilyMember = {
  id: "fm-kid",
  role: "child",
  relationship: "child",
  firstName: "Kid",
  lastName: "T",
  dateOfBirth: "2005-01-01",
};

const BENE_KID: BeneficiaryRef = {
  id: "b1",
  tier: "primary",
  percentage: 100,
  familyMemberId: "fm-kid",
  sortOrder: 0,
};

const BASE = {
  deceased: "client" as const,
  deathOrder: 1 as const,
  familyMembers: [FM_KID] as FamilyMember[],
  externalBeneficiaries: [] as ExternalBeneficiarySummary[],
  entities: [] as EntitySummary[],
  liabilities: [] as Liability[],
  year: 2030,
};

describe("runPourOut", () => {
  it("pours out a fully entity-owned account (the pre-existing behavior)", () => {
    const a = acct("acc-1", [{ kind: "entity", entityId: "trust-1", percent: 1 }]);
    const res = runPourOut({
      ...BASE,
      queue: [{ entityId: "trust-1", trustBeneficiaries: [BENE_KID] }],
      accounts: [a],
      accountBalances: { "acc-1": 1_000_000 },
      basisMap: { "acc-1": 500_000 },
    });

    expect(res.transfers).toHaveLength(1);
    const [t] = res.transfers;
    expect(t.via).toBe("trust_pour_out");
    expect(t.sourceAccountId).toBe("acc-1");
    // §1014 step-up: category "taxable" is neither retirement/life_insurance/
    // annuity (those keep originalBasis) nor isJointAtFirstDeath (runPourOut
    // hardcodes that false — trust accounts are never joint), so
    // computeSteppedUpBasis falls through to `return fmv`: the account's
    // 1,000,000 balance, not the 500,000 basisMap entry.
    expect(t.basis).toBeCloseTo(1_000_000, 2);
    expect(res.transfers.reduce((s, x) => s + x.amount, 0)).toBeCloseTo(1_000_000, 2);
  });

  it("emits liabilities that a gift-aware resolver can read back", () => {
    const a = acct("acc-1", [{ kind: "entity", entityId: "trust-1", percent: 1 }]);
    const trustLiab = liab("liab-1", 100_000, [{ kind: "entity", entityId: "trust-1", percent: 1 }]);
    const famLiab = liab("liab-fam", 50_000, [{ kind: "family_member", familyMemberId: "fm-kid", percent: 1 }]);

    const res = runPourOut({
      ...BASE,
      liabilities: [trustLiab, famLiab],
      queue: [{ entityId: "trust-1", trustBeneficiaries: [BENE_KID] }],
      accounts: [a],
      accountBalances: { "acc-1": 1_000_000 },
      basisMap: { "acc-1": 500_000 },
    });

    for (const l of res.liabilities) {
      expect(() => giftAwareLiabilityOwners(l, [], 2030, 2026)).not.toThrow();
    }

    const outTrustLiab = res.liabilities.find((l) => l.id === "liab-1");
    expect(outTrustLiab?.owners).toEqual([]);

    // The unrelated family-owned liability never matches q.entityId, so
    // runPourOut's .map() passes it through unchanged — same reference, not
    // a copy — while the trust liability above is replaced with owners: [].
    const outFamLiab = res.liabilities.find((l) => l.id === "liab-fam");
    expect(outFamLiab).toBe(famLiab);
  });

  it("selects only a fully entity-owned account", () => {
    // controllingEntity demands a single 100% entity row with no family rows;
    // the trust's 30% of a mixed account is not poured here — the death
    // chain partitions mixed accounts into a `[trust 1]` slice BEFORE the
    // first-death pour-out, but the final-death pour-out runs pre-chain.
    // This pin documents the contract so a future change is deliberate.
    const mixed = acct("acc-mixed", [
      { kind: "family_member", familyMemberId: "fm-c", percent: 0.7 },
      { kind: "entity", entityId: "trust-1", percent: 0.3 },
    ]);
    const full = acct("acc-full", [{ kind: "entity", entityId: "trust-1", percent: 1 }]);

    const res = runPourOut({
      ...BASE,
      queue: [{ entityId: "trust-1", trustBeneficiaries: [BENE_KID] }],
      accounts: [mixed, full],
      accountBalances: { "acc-mixed": 1_000_000, "acc-full": 1_000_000 },
      basisMap: { "acc-mixed": 500_000, "acc-full": 500_000 },
    });

    expect(res.transfers.length).toBeGreaterThan(0);
    expect(res.transfers.every((t) => t.sourceAccountId === "acc-full")).toBe(true);
    expect(res.transfers.some((t) => t.sourceAccountId === "acc-mixed")).toBe(false);
    expect(res.transfers.reduce((s, t) => s + t.amount, 0)).toBeCloseTo(1_000_000, 2);
  });
});
