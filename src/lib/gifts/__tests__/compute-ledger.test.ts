import { describe, it, expect } from "vitest";
import {
  computeExemptionLedger,
  type LedgerGift,
  type LedgerContext,
} from "../compute-ledger";

const ctx: LedgerContext = {
  entitiesById: {
    trust1: { isIrrevocable: true, entityType: "trust" },
  },
  externalsById: {},
  beneficiaryCountsByEntityId: {},
  annualExclusionByYear: {
    2026: 19_000,
  },
};

describe("computeExemptionLedger", () => {
  it("single gift from client to irrevocable trust → one ledger entry", () => {
    const gifts: LedgerGift[] = [
      {
        id: "g1",
        year: 2026,
        amount: 2_400_000,
        grantor: "client",
        useCrummeyPowers: false,
        recipientEntityId: "trust1",
        recipientFamilyMemberId: null,
        recipientExternalBeneficiaryId: null,
      },
    ];
    const r = computeExemptionLedger(gifts, ctx);
    expect(r).toEqual([
      {
        grantor: "client",
        year: 2026,
        lifetimeUsedThisYear: 2_400_000,
        cumulativeLifetimeUsed: 2_400_000,
      },
    ]);
  });

  it("joint gift splits 50/50 into two grantor entries", () => {
    const gifts: LedgerGift[] = [
      {
        id: "g1",
        year: 2026,
        amount: 2_400_000,
        grantor: "joint",
        useCrummeyPowers: false,
        recipientEntityId: "trust1",
        recipientFamilyMemberId: null,
        recipientExternalBeneficiaryId: null,
      },
    ];
    const r = computeExemptionLedger(gifts, ctx);
    expect(r).toEqual([
      {
        grantor: "client",
        year: 2026,
        lifetimeUsedThisYear: 1_200_000,
        cumulativeLifetimeUsed: 1_200_000,
      },
      {
        grantor: "spouse",
        year: 2026,
        lifetimeUsedThisYear: 1_200_000,
        cumulativeLifetimeUsed: 1_200_000,
      },
    ]);
  });

  it("multi-year cumulative sums per grantor", () => {
    const gifts: LedgerGift[] = [
      {
        id: "g1",
        year: 2026,
        amount: 1_000_000,
        grantor: "client",
        useCrummeyPowers: false,
        recipientEntityId: "trust1",
        recipientFamilyMemberId: null,
        recipientExternalBeneficiaryId: null,
      },
      {
        id: "g2",
        year: 2027,
        amount: 500_000,
        grantor: "client",
        useCrummeyPowers: false,
        recipientEntityId: "trust1",
        recipientFamilyMemberId: null,
        recipientExternalBeneficiaryId: null,
      },
      {
        id: "g3",
        year: 2027,
        amount: 300_000,
        grantor: "spouse",
        useCrummeyPowers: false,
        recipientEntityId: "trust1",
        recipientFamilyMemberId: null,
        recipientExternalBeneficiaryId: null,
      },
    ];
    const ctx2: LedgerContext = {
      ...ctx,
      annualExclusionByYear: { 2026: 19_000, 2027: 19_000 },
    };
    const r = computeExemptionLedger(gifts, ctx2);
    expect(r).toEqual([
      {
        grantor: "client",
        year: 2026,
        lifetimeUsedThisYear: 1_000_000,
        cumulativeLifetimeUsed: 1_000_000,
      },
      {
        grantor: "client",
        year: 2027,
        lifetimeUsedThisYear: 500_000,
        cumulativeLifetimeUsed: 1_500_000,
      },
      {
        grantor: "spouse",
        year: 2027,
        lifetimeUsedThisYear: 300_000,
        cumulativeLifetimeUsed: 300_000,
      },
    ]);
  });

  it("skips zero-lifetime gifts (annual-excluded, charitable)", () => {
    const gifts: LedgerGift[] = [
      {
        id: "g1",
        year: 2026,
        amount: 10_000,
        grantor: "client",
        useCrummeyPowers: false,
        recipientEntityId: null,
        recipientFamilyMemberId: "fm1",
        recipientExternalBeneficiaryId: null,
      },
    ];
    const r = computeExemptionLedger(gifts, ctx);
    expect(r).toEqual([]);
  });

  // §2503(b): ONE annual exclusion per donee per year (BUG #8). Two gifts to the
  // same Crummey trust in the same year share a single AE × beneficiaryCount cap.
  const crummeyCtx: LedgerContext = {
    entitiesById: { trust1: { isIrrevocable: true, entityType: "trust" } },
    externalsById: {},
    beneficiaryCountsByEntityId: { trust1: 1 },
    annualExclusionByYear: { 2026: 19_000 },
  };

  it("two Crummey cash gifts to the same trust in one year share ONE exclusion", () => {
    const gifts: LedgerGift[] = [
      {
        id: "g1",
        year: 2026,
        amount: 19_000,
        grantor: "client",
        useCrummeyPowers: true,
        recipientEntityId: "trust1",
        recipientFamilyMemberId: null,
        recipientExternalBeneficiaryId: null,
      },
      {
        id: "g2",
        year: 2026,
        amount: 19_000,
        grantor: "client",
        useCrummeyPowers: true,
        recipientEntityId: "trust1",
        recipientFamilyMemberId: null,
        recipientExternalBeneficiaryId: null,
      },
    ];
    // 38k − one 19k exclusion = 19k lifetime used. BEFORE FIX: each gift claimed
    // its own 19k exclusion → both fully excluded → no ledger entry at all.
    const r = computeExemptionLedger(gifts, crummeyCtx);
    expect(r).toEqual([
      {
        grantor: "client",
        year: 2026,
        lifetimeUsedThisYear: 19_000,
        cumulativeLifetimeUsed: 19_000,
      },
    ]);
  });

  it("GUARD: a single Crummey cash gift still gets one full exclusion", () => {
    const gifts: LedgerGift[] = [
      {
        id: "g1",
        year: 2026,
        amount: 50_000,
        grantor: "client",
        useCrummeyPowers: true,
        recipientEntityId: "trust1",
        recipientFamilyMemberId: null,
        recipientExternalBeneficiaryId: null,
      },
    ];
    const r = computeExemptionLedger(gifts, crummeyCtx);
    expect(r).toEqual([
      {
        grantor: "client",
        year: 2026,
        lifetimeUsedThisYear: 31_000,
        cumulativeLifetimeUsed: 31_000,
      },
    ]);
  });

  it("mixed group: Crummey cash + asset (no-AE) to the SAME trust do not pool the cash exclusion", () => {
    const gifts: LedgerGift[] = [
      {
        id: "cash",
        year: 2026,
        amount: 19_000,
        grantor: "client",
        useCrummeyPowers: true,
        recipientEntityId: "trust1",
        recipientFamilyMemberId: null,
        recipientExternalBeneficiaryId: null,
      },
      {
        id: "asset",
        year: 2026,
        amount: 200_000,
        grantor: "client",
        useCrummeyPowers: false, // asset transfer: no AE
        recipientEntityId: "trust1",
        recipientFamilyMemberId: null,
        recipientExternalBeneficiaryId: null,
      },
    ];
    // Cash nets to 0 against its 19k exclusion; asset stays fully taxable.
    const r = computeExemptionLedger(gifts, crummeyCtx);
    expect(r).toEqual([
      {
        grantor: "client",
        year: 2026,
        lifetimeUsedThisYear: 200_000,
        cumulativeLifetimeUsed: 200_000,
      },
    ]);
  });
});
