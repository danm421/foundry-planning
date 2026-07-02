import { describe, it, expect } from "vitest";
import {
  computeFederalEstateTax,
  computeDeductions,
  computeGrossEstate,
} from "../estate-tax";
import { applyFirstDeath } from "../index";
import type { DeathEventInput } from "../index";
import type {
  Account, Liability, DeathTransfer, EntitySummary, GrossEstateLine, PlanSettings,
  FamilyMember,
} from "../../types";
import { LEGACY_FM_CLIENT, LEGACY_FM_SPOUSE } from "../../ownership";

describe("computeFederalEstateTax", () => {
  it("reproduces the Form 706 screenshot walkthrough (zero tax, simplified DSUE)", () => {
    const r = computeFederalEstateTax({
      taxableEstate: 50_000,
      adjustedTaxableGifts: 14_000_000,
      beaAtDeathYear: 15_000_000,
      dsueReceived: 0,
    });
    expect(r.tentativeTaxBase).toBe(14_050_000);
    expect(r.tentativeTax).toBeCloseTo(5_565_800, 2);
    expect(r.applicableExclusion).toBe(15_000_000);
    expect(r.unifiedCredit).toBeCloseTo(5_945_800, 2);
    expect(r.federalEstateTax).toBe(0);
  });

  it("computes non-zero federal tax when tentative base exceeds applicable exclusion", () => {
    const r = computeFederalEstateTax({
      taxableEstate: 25_000_000,
      adjustedTaxableGifts: 0,
      beaAtDeathYear: 15_000_000,
      dsueReceived: 5_000_000,
    });
    expect(r.federalEstateTax).toBeCloseTo(2_000_000, 2);
  });

  it("clamps federal tax at zero for small estates", () => {
    const r = computeFederalEstateTax({
      taxableEstate: 100_000,
      adjustedTaxableGifts: 0,
      beaAtDeathYear: 15_000_000,
      dsueReceived: 0,
    });
    expect(r.federalEstateTax).toBe(0);
  });

  it("applies DSUE additively to BEA for the applicable exclusion", () => {
    const r = computeFederalEstateTax({
      taxableEstate: 20_000_000,
      adjustedTaxableGifts: 0,
      beaAtDeathYear: 15_000_000,
      dsueReceived: 10_000_000,
    });
    expect(r.applicableExclusion).toBe(25_000_000);
    expect(r.federalEstateTax).toBe(0);
  });

  // F1 — §2001(b)(2): the tax must back out gift tax payable on post-1976
  // gifts (at date-of-death rates) so lifetime gifts that exceeded the
  // exemption aren't taxed twice. Before the fix this returned $6,000,000.
  it("subtracts §2001(b)(2) gift tax payable on over-exemption lifetime gifts", () => {
    const r = computeFederalEstateTax({
      taxableEstate: 10_000_000,
      adjustedTaxableGifts: 20_000_000,
      beaAtDeathYear: 15_000_000,
      dsueReceived: 0,
    });
    // tentativeTax       = rate($30M)              = 11,945,800
    // giftTaxPayable     = rate($20M) − rate($15M) =  2,000,000
    // unifiedCredit      = rate($15M)              =  5,945,800
    // federalEstateTax   = 11,945,800 − 2,000,000 − 5,945,800 = 4,000,000
    expect(r.giftTaxPayable).toBeCloseTo(2_000_000, 2);
    expect(r.federalEstateTax).toBeCloseTo(4_000_000, 2);
  });

  it("leaves gift tax payable at zero when cumulative gifts stay within the exemption", () => {
    const r = computeFederalEstateTax({
      taxableEstate: 10_000_000,
      adjustedTaxableGifts: 5_000_000,
      beaAtDeathYear: 15_000_000,
      dsueReceived: 0,
    });
    expect(r.giftTaxPayable).toBe(0);
  });
});

function liab(id: string, balance: number, extras: Partial<Liability> = {}): Liability {
  return {
    id,
    name: `Liability ${id}`,
    balance,
    interestRate: 0,
    monthlyPayment: 0,
    startYear: 2025,
    startMonth: 1,
    termMonths: 0,
    extraPayments: [],
    owners: [],
    ...extras,
  };
}

function acct(id: string, value: number, extras: Partial<Account> = {}): Account {
  return {
    id,
    name: `Account ${id}`,
    category: "cash",
    subType: "generic",
    titlingType: "jtwros",
    value,
    basis: value,
    growthRate: 0,
    rmdEnabled: false,
    owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    ...extras,
  };
}

describe("computeGrossEstate", () => {
  it("includes 100% of decedent's individually-owned accounts", () => {
    const r = computeGrossEstate({
      deceased: "client",
      deathOrder: 1,
      accounts: [acct("a1", 100_000)],
      accountBalances: { a1: 100_000 },
      liabilities: [],
      entities: [],
      deceasedFmId: LEGACY_FM_CLIENT,
      survivorFmId: LEGACY_FM_SPOUSE,
    });
    expect(r.total).toBeCloseTo(100_000, 2);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].percentage).toBe(1);
    expect(r.lines[0].amount).toBe(100_000);
  });

  it("includes 50% of joint accounts at first death", () => {
    const r = computeGrossEstate({
      deceased: "client",
      deathOrder: 1,
      accounts: [acct("j1", 200_000, {
        owners: [
          { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.5 },
          { kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 0.5 },
        ],
      })],
      accountBalances: { j1: 200_000 },
      liabilities: [],
      entities: [],
      deceasedFmId: LEGACY_FM_CLIENT,
      survivorFmId: LEGACY_FM_SPOUSE,
    });
    expect(r.total).toBeCloseTo(100_000, 2);
    expect(r.lines[0].percentage).toBe(0.5);
    expect(r.lines[0].label).toContain("(50%)");
  });

  it("community_property joint account still includes 50% in decedent's gross estate at first death", () => {
    // Regression guard against a subtle conflation: §1014(b)(6) gives BOTH halves
    // a full basis step-up at the first spouse's death, but only the decedent's
    // half is included in their gross estate — same as JTWROS. CP changes basis,
    // not gross-estate inclusion.
    const r = computeGrossEstate({
      deceased: "client",
      deathOrder: 1,
      accounts: [acct("cp1", 2_000_000, {
        basis: 800_000,
        titlingType: "community_property",
        owners: [
          { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.5 },
          { kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 0.5 },
        ],
      })],
      accountBalances: { cp1: 2_000_000 },
      liabilities: [],
      entities: [],
      deceasedFmId: LEGACY_FM_CLIENT,
      survivorFmId: LEGACY_FM_SPOUSE,
    });
    // Decedent's gross estate = 50% of $2M = $1M (NOT $2M).
    expect(r.total).toBeCloseTo(1_000_000, 2);
    expect(r.lines[0].amount).toBeCloseTo(1_000_000, 2);
    expect(r.lines[0].percentage).toBe(0.5);
    expect(r.lines[0].label).toContain("(50%)");
  });

  it("excludes spouse-owned accounts", () => {
    const r = computeGrossEstate({
      deceased: "client",
      deathOrder: 1,
      accounts: [acct("s1", 100_000, {
        owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 1 }],
      })],
      accountBalances: { s1: 100_000 },
      liabilities: [],
      entities: [],
      deceasedFmId: LEGACY_FM_CLIENT,
      survivorFmId: LEGACY_FM_SPOUSE,
    });
    expect(r.total).toBe(0);
    expect(r.lines).toEqual([]);
  });

  it("excludes accounts inside irrevocable trusts (ILIT / IDGT)", () => {
    const entity: EntitySummary = {
      id: "ilit",
      includeInPortfolio: false,
      isGrantor: false,
      isIrrevocable: true,
      grantor: "client",
    };
    const r = computeGrossEstate({
      deceased: "client",
      deathOrder: 1,
      accounts: [acct("ilit-a1", 500_000, {
        owners: [{ kind: "entity", entityId: "ilit", percent: 1 }],
      })],
      accountBalances: { "ilit-a1": 500_000 },
      liabilities: [],
      entities: [entity],
      deceasedFmId: LEGACY_FM_CLIENT,
      survivorFmId: LEGACY_FM_SPOUSE,
    });
    expect(r.total).toBe(0);
  });

  it("includes 100% of accounts in revocable trust where decedent is grantor", () => {
    const entity: EntitySummary = {
      id: "rev",
      includeInPortfolio: true,
      isGrantor: true,
      isIrrevocable: false,
      grantor: "client",
    };
    const r = computeGrossEstate({
      deceased: "client",
      deathOrder: 1,
      accounts: [acct("rev-a1", 300_000, {
        owners: [{ kind: "entity", entityId: "rev", percent: 1 }],
      })],
      accountBalances: { "rev-a1": 300_000 },
      liabilities: [],
      entities: [entity],
      deceasedFmId: LEGACY_FM_CLIENT,
      survivorFmId: LEGACY_FM_SPOUSE,
    });
    expect(r.total).toBeCloseTo(300_000, 2);
  });

  it("folds liabilities as negative gross-estate lines", () => {
    const r = computeGrossEstate({
      deceased: "client",
      deathOrder: 1,
      accounts: [acct("a1", 100_000)],
      accountBalances: { a1: 100_000 },
      liabilities: [liab("d1", 20_000)],
      entities: [],
      deceasedFmId: LEGACY_FM_CLIENT,
      survivorFmId: LEGACY_FM_SPOUSE,
    });
    expect(r.total).toBeCloseTo(100_000 - 10_000, 2);
    const debtLine = r.lines.find((l) => l.liabilityId === "d1");
    expect(debtLine?.amount).toBeCloseTo(-10_000, 2);
  });

  it("at final death, unlinked household liability is 100% in decedent's estate", () => {
    const r = computeGrossEstate({
      deceased: "client",
      deathOrder: 2,
      accounts: [acct("a1", 100_000)],
      accountBalances: { a1: 100_000 },
      liabilities: [liab("d1", 20_000)],
      entities: [],
      deceasedFmId: LEGACY_FM_CLIENT,
      survivorFmId: null,
    });
    expect(r.total).toBeCloseTo(100_000 - 20_000, 2);
  });

  it("includes 100% of liabilities individually owned by decedent at first death", () => {
    const r = computeGrossEstate({
      deceased: "client",
      deathOrder: 1,
      accounts: [acct("a1", 100_000)],
      accountBalances: { a1: 100_000 },
      liabilities: [liab("d1", 20_000, {
        owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
      })],
      entities: [],
      deceasedFmId: LEGACY_FM_CLIENT,
      survivorFmId: LEGACY_FM_SPOUSE,
    });
    const debtLine = r.lines.find((l) => l.liabilityId === "d1");
    expect(debtLine?.percentage).toBe(1);
    expect(debtLine?.amount).toBeCloseTo(-20_000, 2);
    expect(r.total).toBeCloseTo(100_000 - 20_000, 2);
  });

  it("excludes liabilities individually owned by survivor at first death", () => {
    const r = computeGrossEstate({
      deceased: "client",
      deathOrder: 1,
      accounts: [acct("a1", 100_000)],
      accountBalances: { a1: 100_000 },
      liabilities: [liab("d1", 20_000, {
        owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 1 }],
      })],
      entities: [],
      deceasedFmId: LEGACY_FM_CLIENT,
      survivorFmId: LEGACY_FM_SPOUSE,
    });
    expect(r.lines.find((l) => l.liabilityId === "d1")).toBeUndefined();
    expect(r.total).toBeCloseTo(100_000, 2);
  });

  it("uses entityAccountSharesEoY so a household withdrawal doesn't bleed the SLAT share into the joint convention", () => {
    // 35% client + 35% spouse + 30% non-IIP irrevocable SLAT.
    // Plan-start $1M; household withdrew $79k → ledger.endingValue $921k.
    // Engine's locked SLAT share = $300k (untouched). The joint convention
    // must apply to the family pool ($621k), NOT the post-withdrawal total.
    const slat: EntitySummary = {
      id: "slat",
      includeInPortfolio: false,
      isGrantor: false,
      isIrrevocable: true,
      grantor: "client",
    };
    const r = computeGrossEstate({
      deceased: "client",
      deathOrder: 1,
      accounts: [acct("mixed", 1_000_000, {
        owners: [
          { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.35 },
          { kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 0.35 },
          { kind: "entity", entityId: "slat", percent: 0.3 },
        ],
      })],
      accountBalances: { mixed: 921_000 },
      liabilities: [],
      entities: [slat],
      deceasedFmId: LEGACY_FM_CLIENT,
      survivorFmId: LEGACY_FM_SPOUSE,
      entityAccountSharesEoY: new Map([
        ["slat", new Map([["mixed", 300_000]])],
      ]),
    });
    // Family pool $621k × 0.5 (joint, first death) = $310,500.
    // (Buggy result was $921k × 0.5 = $460,500.)
    // percentage is now effPct = amount / fmv = 310_500 / 921_000.
    expect(r.total).toBeCloseTo(310_500, 2);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].percentage).toBeCloseTo(310_500 / 921_000, 6);
  });

  it("treats a single-FM-with-entity account as sole-owned, not joint, at first death", () => {
    // 70% Cooper (no spouse FM on this account) + 30% non-IIP irrevocable SLAT.
    // Plan-start $1M; household withdrew $79k → ledger.endingValue $921k,
    // entity locked share $300k, family pool $621k. Cooper is the sole
    // family-pool owner — the joint convention's `× 0.5` must NOT apply.
    const slat: EntitySummary = {
      id: "slat",
      includeInPortfolio: false,
      isGrantor: false,
      isIrrevocable: true,
      grantor: "client",
    };
    const r = computeGrossEstate({
      deceased: "client",
      deathOrder: 1,
      accounts: [acct("mixed", 1_000_000, {
        owners: [
          { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.7 },
          { kind: "entity", entityId: "slat", percent: 0.3 },
        ],
      })],
      accountBalances: { mixed: 921_000 },
      liabilities: [],
      entities: [slat],
      deceasedFmId: LEGACY_FM_CLIENT,
      survivorFmId: null,
      entityAccountSharesEoY: new Map([
        ["slat", new Map([["mixed", 300_000]])],
      ]),
    });
    // percentage is now effPct = amount / fmv = 621_000 / 921_000.
    expect(r.total).toBeCloseTo(621_000, 2);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].percentage).toBeCloseTo(621_000 / 921_000, 6);
  });

  it("treats a single-FM-with-entity account where the survivor is the FM as excluded", () => {
    // Mirror case: the lone FM is the survivor — Cooper's spouse owns 70%,
    // SLAT owns 30%. Cooper's death pulls in 0%.
    const slat: EntitySummary = {
      id: "slat",
      includeInPortfolio: false,
      isGrantor: false,
      isIrrevocable: true,
      grantor: "client",
    };
    const r = computeGrossEstate({
      deceased: "client",
      deathOrder: 1,
      accounts: [acct("mixed", 1_000_000, {
        owners: [
          { kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 0.7 },
          { kind: "entity", entityId: "slat", percent: 0.3 },
        ],
      })],
      accountBalances: { mixed: 921_000 },
      liabilities: [],
      entities: [slat],
      deceasedFmId: LEGACY_FM_CLIENT,
      survivorFmId: LEGACY_FM_SPOUSE,
      entityAccountSharesEoY: new Map([
        ["slat", new Map([["mixed", 300_000]])],
      ]),
    });
    expect(r.total).toBe(0);
    expect(r.lines).toEqual([]);
  });

  it("single-FM-with-entity at second death routes the lone FM at pct=1 (no deathOrder discrimination)", () => {
    // Documents the invariant: the single-FM branch must NOT branch on
    // deathOrder. The multi-FM joint branch does (0.5 → 1), but a sole
    // family-pool owner is always at 100% regardless of which death this is.
    const slat: EntitySummary = {
      id: "slat",
      includeInPortfolio: false,
      isGrantor: false,
      isIrrevocable: true,
      grantor: "client",
    };
    const r = computeGrossEstate({
      deceased: "client",
      deathOrder: 2,
      accounts: [acct("mixed", 1_000_000, {
        owners: [
          { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.7 },
          { kind: "entity", entityId: "slat", percent: 0.3 },
        ],
      })],
      accountBalances: { mixed: 921_000 },
      liabilities: [],
      entities: [slat],
      deceasedFmId: LEGACY_FM_CLIENT,
      survivorFmId: null,
      entityAccountSharesEoY: new Map([
        ["slat", new Map([["mixed", 300_000]])],
      ]),
    });
    // percentage is now effPct = amount / fmv = 621_000 / 921_000.
    expect(r.total).toBeCloseTo(621_000, 2);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].percentage).toBeCloseTo(621_000 / 921_000, 6);
  });

  it("joint convention without locked shares falls back to existing fmv × pct (backward-compatible)", () => {
    // Pure-spouse joint, no entity, no locked shares passed — old behavior.
    const r = computeGrossEstate({
      deceased: "client",
      deathOrder: 1,
      accounts: [acct("j1", 200_000, {
        owners: [
          { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.5 },
          { kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 0.5 },
        ],
      })],
      accountBalances: { j1: 200_000 },
      liabilities: [],
      entities: [],
      deceasedFmId: LEGACY_FM_CLIENT,
      survivorFmId: LEGACY_FM_SPOUSE,
    });
    expect(r.total).toBeCloseTo(100_000, 2);
  });

  it("decedent-owned liability linked to a joint property still uses the liability's owners", () => {
    // Regression: previously the linked-property's ownership overrode the
    // liability's own owners[]. A loan explicitly owned by the client should
    // be 100% in the client's estate even when the linked property is joint.
    const r = computeGrossEstate({
      deceased: "client",
      deathOrder: 1,
      accounts: [acct("home", 500_000, {
        owners: [
          { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.5 },
          { kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 0.5 },
        ],
      })],
      accountBalances: { home: 500_000 },
      liabilities: [liab("mortgage", 100_000, {
        linkedPropertyId: "home",
        owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
      })],
      entities: [],
      deceasedFmId: LEGACY_FM_CLIENT,
      survivorFmId: LEGACY_FM_SPOUSE,
    });
    const debtLine = r.lines.find((l) => l.liabilityId === "mortgage");
    expect(debtLine?.percentage).toBe(1);
    expect(debtLine?.amount).toBeCloseTo(-100_000, 2);
  });

  it("includes the rev-trust-grantor slice on a mixed account at first death (single-FM + rev-trust)", () => {
    // 70% Cooper + 30% Cooper's revocable trust. Cooper is grantor of the trust.
    // No spouse. ledger.endingValue $1M. Both slices should be in Cooper's
    // gross estate at first death:
    //   family pool ($700k) routed via single-FM-as-sole-owner branch (Phase 1) → $700k × 1
    //   rev-trust slice ($300k) routed via "controllingEntity" rules → $300k × 1
    // Total: $1,000,000.
    const rev: EntitySummary = {
      id: "rev",
      includeInPortfolio: true,
      isGrantor: true,
      isIrrevocable: false,
      grantor: "client",
    };
    const r = computeGrossEstate({
      deceased: "client",
      deathOrder: 1,
      accounts: [acct("mixed", 1_000_000, {
        owners: [
          { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.7 },
          { kind: "entity", entityId: "rev", percent: 0.3 },
        ],
      })],
      accountBalances: { mixed: 1_000_000 },
      liabilities: [],
      entities: [rev],
      deceasedFmId: LEGACY_FM_CLIENT,
      survivorFmId: null,
      entityAccountSharesEoY: new Map([
        ["rev", new Map([["mixed", 300_000]])],
      ]),
    });
    expect(r.total).toBeCloseTo(1_000_000, 2);
  });

  it("includes the rev-trust-grantor slice on a multi-FM joint + rev-trust account at first death", () => {
    // 35% Cooper + 35% spouse + 30% Cooper's revocable trust at first death.
    // Family pool $700k joint convention → Cooper's share $350k.
    // Rev-trust slice $300k × 1 (Cooper is grantor).
    // Total: $650k.
    const rev: EntitySummary = {
      id: "rev",
      includeInPortfolio: true,
      isGrantor: true,
      isIrrevocable: false,
      grantor: "client",
    };
    const r = computeGrossEstate({
      deceased: "client",
      deathOrder: 1,
      accounts: [acct("mixed", 1_000_000, {
        owners: [
          { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.35 },
          { kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 0.35 },
          { kind: "entity", entityId: "rev", percent: 0.3 },
        ],
      })],
      accountBalances: { mixed: 1_000_000 },
      liabilities: [],
      entities: [rev],
      deceasedFmId: LEGACY_FM_CLIENT,
      survivorFmId: LEGACY_FM_SPOUSE,
      entityAccountSharesEoY: new Map([
        ["rev", new Map([["mixed", 300_000]])],
      ]),
    });
    expect(r.total).toBeCloseTo(650_000, 2);
  });

  it("excludes the irrevocable-trust slice on a multi-FM joint + irrev-trust account at first death", () => {
    // Regression check that the rev-trust fix doesn't break the existing
    // irrevocable-trust path. Irrevocable trusts are excluded from the
    // gross estate; only the family pool's joint share is included.
    const slat: EntitySummary = {
      id: "slat",
      includeInPortfolio: false,
      isGrantor: false,
      isIrrevocable: true,
      grantor: "client",
    };
    const r = computeGrossEstate({
      deceased: "client",
      deathOrder: 1,
      accounts: [acct("mixed", 1_000_000, {
        owners: [
          { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.35 },
          { kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 0.35 },
          { kind: "entity", entityId: "slat", percent: 0.3 },
        ],
      })],
      accountBalances: { mixed: 1_000_000 },
      liabilities: [],
      entities: [slat],
      deceasedFmId: LEGACY_FM_CLIENT,
      survivorFmId: LEGACY_FM_SPOUSE,
      entityAccountSharesEoY: new Map([
        ["slat", new Map([["mixed", 300_000]])],
      ]),
    });
    // Family pool = $700k × 0.5 (joint, first death) = $350k. Trust excluded.
    expect(r.total).toBeCloseTo(350_000, 2);
  });

  it("includes ONLY the rev-trust-grantor slice when the lone FM owner is the survivor", () => {
    // 70% spouse (survivor) + 30% client's revocable trust (client = deceased
    // = grantor). Family pool ($700k) belongs to the survivor → contributes 0.
    // Rev-trust slice ($300k) is in the deceased's estate at × 1.
    // Total: $300k.
    const rev: EntitySummary = {
      id: "rev",
      includeInPortfolio: true,
      isGrantor: true,
      isIrrevocable: false,
      grantor: "client",
    };
    const r = computeGrossEstate({
      deceased: "client",
      deathOrder: 1,
      accounts: [acct("mixed", 1_000_000, {
        owners: [
          { kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 0.7 },
          { kind: "entity", entityId: "rev", percent: 0.3 },
        ],
      })],
      accountBalances: { mixed: 1_000_000 },
      liabilities: [],
      entities: [rev],
      deceasedFmId: LEGACY_FM_CLIENT,
      survivorFmId: LEGACY_FM_SPOUSE,
      entityAccountSharesEoY: new Map([
        ["rev", new Map([["mixed", 300_000]])],
      ]),
    });
    expect(r.total).toBeCloseTo(300_000, 2);
    expect(r.lines).toHaveLength(1);
  });

  it("includes a wholly-business-owned account by the deceased's ownership share", () => {
    // Client's LLC (top-level business account) has a child cash account.
    // Client owns 100% of the LLC. Consolidated business value =
    // llcAccount.value (0) + child balance = $500k.
    const llcAccount: Account = {
      id: "biz-llc",
      name: "Client LLC",
      category: "business",
      subType: "llc",
      value: 0,
      basis: 0,
      businessType: "llc",
      parentAccountId: null,
      growthRate: 0,
      rmdEnabled: false,
      titlingType: "jtwros",
      owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    };
    const childAccount = acct("llc-a1", 500_000, {
      parentAccountId: "biz-llc",
      owners: [],
    });
    const r = computeGrossEstate({
      deceased: "client",
      deathOrder: 1,
      accounts: [llcAccount, childAccount],
      accountBalances: { "biz-llc": 0, "llc-a1": 500_000 },
      liabilities: [],
      entities: [],
      deceasedFmId: LEGACY_FM_CLIENT,
      survivorFmId: LEGACY_FM_SPOUSE,
    });
    expect(r.total).toBeCloseTo(500_000, 2);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].percentage).toBeCloseTo(1, 6);
  });

  it("includes only the deceased's fractional share of a partly-owned business", () => {
    // LLC (business account) holds a $500k child cash account. Client 60%,
    // spouse 40%. At client's death only the client's 60% belongs in the
    // gross estate.
    const llcAccount: Account = {
      id: "biz-llc",
      name: "LLC",
      category: "business",
      subType: "llc",
      value: 0,
      basis: 0,
      businessType: "llc",
      parentAccountId: null,
      growthRate: 0,
      rmdEnabled: false,
      titlingType: "jtwros",
      owners: [
        { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.6 },
        { kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 0.4 },
      ],
    };
    const childAccount = acct("llc-a1", 500_000, {
      parentAccountId: "biz-llc",
      owners: [],
    });
    const r = computeGrossEstate({
      deceased: "client",
      deathOrder: 1,
      accounts: [llcAccount, childAccount],
      accountBalances: { "biz-llc": 0, "llc-a1": 500_000 },
      liabilities: [],
      entities: [],
      deceasedFmId: LEGACY_FM_CLIENT,
      survivorFmId: LEGACY_FM_SPOUSE,
    });
    expect(r.total).toBeCloseTo(300_000, 2);
    expect(r.lines[0].percentage).toBeCloseTo(0.6, 6);
  });

  it("excludes a business owned entirely by the survivor", () => {
    const llc: EntitySummary = {
      id: "llc",
      includeInPortfolio: true,
      isGrantor: false,
      entityType: "llc",
      owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 1 }],
    };
    const r = computeGrossEstate({
      deceased: "client",
      deathOrder: 1,
      accounts: [acct("llc-a1", 500_000, {
        owners: [{ kind: "entity", entityId: "llc", percent: 1 }],
      })],
      accountBalances: { "llc-a1": 500_000 },
      liabilities: [],
      entities: [llc],
      deceasedFmId: LEGACY_FM_CLIENT,
      survivorFmId: LEGACY_FM_SPOUSE,
    });
    expect(r.total).toBe(0);
    expect(r.lines).toEqual([]);
  });

  // The legacy "mixed family + business slice on the same account" pattern
  // relied on an account having a kind:"entity" owner pointing at a business
  // entity. Under the new account-based business model, businesses are
  // separate top-level accounts and there is no kind:"business-account" owner
  // type. The same intent can be expressed via two separate accounts (one
  // family-owned + one business-owned), so we drop the cross-ownership case.

  it("includes a business-owned liability by the deceased's ownership share", () => {
    const llc: EntitySummary = {
      id: "llc",
      includeInPortfolio: true,
      isGrantor: false,
      entityType: "llc",
      owners: [
        { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.6 },
        { kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 0.4 },
      ],
    };
    const r = computeGrossEstate({
      deceased: "client",
      deathOrder: 1,
      accounts: [acct("a1", 100_000)],
      accountBalances: { a1: 100_000 },
      liabilities: [liab("llc-debt", 50_000, {
        owners: [{ kind: "entity", entityId: "llc", percent: 1 }],
      })],
      entities: [llc],
      deceasedFmId: LEGACY_FM_CLIENT,
      survivorFmId: LEGACY_FM_SPOUSE,
    });
    const debtLine = r.lines.find((l) => l.liabilityId === "llc-debt");
    expect(debtLine?.amount).toBeCloseTo(-30_000, 2);
    expect(r.total).toBeCloseTo(100_000 - 30_000, 2);
  });

  // The "legacy business with no owners[] → joint convention" path applied to
  // EntitySummary fixtures. Under the account-based business model, business
  // accounts always carry an `owners` array (possibly empty). A business
  // account with no family-member owners reads as no in-estate inclusion; the
  // joint convention only applies to multi-FM family-pool ownership. The
  // legacy semantics aren't preserved by the new model.

  it("includes a business account's flat value by the deceased's ownership share", () => {
    // Sample Consulting LLC modeled as a top-level business account with a
    // $250k operating value carried on the account itself. Client owns 100%.
    const llcAccount: Account = {
      id: "biz-llc",
      name: "Sample Consulting LLC",
      category: "business",
      subType: "llc",
      value: 250_000,
      basis: 0,
      businessType: "llc",
      parentAccountId: null,
      growthRate: 0,
      rmdEnabled: false,
      titlingType: "jtwros",
      owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    };
    const r = computeGrossEstate({
      deceased: "client",
      deathOrder: 1,
      accounts: [llcAccount],
      accountBalances: { "biz-llc": 250_000 },
      liabilities: [],
      entities: [],
      deceasedFmId: LEGACY_FM_CLIENT,
      survivorFmId: LEGACY_FM_SPOUSE,
    });
    // The dedicated business-consolidation line is keyed by accountId, with
    // entityId: null. The transitional production code may also emit a
    // per-account line (Task 1.7 cleanup will remove the double-count), so
    // assert the consolidated line is present and at the right amount.
    const bizLine = r.lines.find((l) => l.accountId === "biz-llc" && l.entityId === null);
    expect(bizLine).toBeDefined();
    expect(bizLine!.amount).toBeCloseTo(250_000, 2);
    expect(bizLine!.label).toContain("Sample Consulting LLC");
  });

  it("includes only the deceased's fractional share of a business's flat value", () => {
    const llcAccount: Account = {
      id: "biz-llc",
      name: "Consulting LLC",
      category: "business",
      subType: "llc",
      value: 250_000,
      basis: 0,
      businessType: "llc",
      parentAccountId: null,
      growthRate: 0,
      rmdEnabled: false,
      titlingType: "jtwros",
      owners: [
        { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.6 },
        { kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 0.4 },
      ],
    };
    const r = computeGrossEstate({
      deceased: "client",
      deathOrder: 1,
      accounts: [llcAccount],
      accountBalances: { "biz-llc": 250_000 },
      liabilities: [],
      entities: [],
      deceasedFmId: LEGACY_FM_CLIENT,
      survivorFmId: LEGACY_FM_SPOUSE,
    });
    const bizLine = r.lines.find((l) => l.accountId === "biz-llc" && l.entityId === null);
    expect(bizLine).toBeDefined();
    expect(bizLine!.percentage).toBeCloseTo(0.6, 6);
    expect(bizLine!.amount).toBeCloseTo(150_000, 2);
  });

  it("excludes a business's flat value when owned entirely by the survivor", () => {
    const llc: EntitySummary = {
      id: "llc",
      name: "Consulting LLC",
      includeInPortfolio: false,
      isGrantor: false,
      entityType: "llc",
      value: 250_000,
      owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 1 }],
    };
    const r = computeGrossEstate({
      deceased: "client",
      deathOrder: 1,
      accounts: [],
      accountBalances: {},
      liabilities: [],
      entities: [llc],
      deceasedFmId: LEGACY_FM_CLIENT,
      survivorFmId: LEGACY_FM_SPOUSE,
    });
    expect(r.total).toBe(0);
    expect(r.lines).toEqual([]);
  });

  // The "legacy business → joint convention via missing owners[]" path
  // doesn't apply to business accounts (their `owners` array is always
  // present, possibly empty). See sibling test deletions above.

  it("does not emit a flat-value line for trusts (they hold value via accounts)", () => {
    // A trust with a stray `value` set must not produce a flat-value line —
    // only business entities carry operating value in `entity.value`.
    const trust: EntitySummary = {
      id: "t",
      name: "Family Trust",
      includeInPortfolio: true,
      isGrantor: true,
      isIrrevocable: false,
      grantor: "client",
      entityType: "trust",
      value: 999_999,
    };
    const r = computeGrossEstate({
      deceased: "client",
      deathOrder: 1,
      accounts: [],
      accountBalances: {},
      liabilities: [],
      entities: [trust],
      deceasedFmId: LEGACY_FM_CLIENT,
      survivorFmId: LEGACY_FM_SPOUSE,
    });
    expect(r.total).toBe(0);
    expect(r.lines).toEqual([]);
  });

  it("consolidates a business's flat value and its bank account into one line", () => {
    // LLC modeled as a top-level business account ($250k operating value);
    // bank account is a child via parentAccountId ($40k). Consolidated value
    // = $290k routed to one business line keyed by the business account id.
    const llcAccount: Account = {
      id: "biz-llc",
      name: "Consulting LLC",
      category: "business",
      subType: "llc",
      value: 250_000,
      basis: 0,
      businessType: "llc",
      parentAccountId: null,
      growthRate: 0,
      rmdEnabled: false,
      titlingType: "jtwros",
      owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    };
    const childCash = acct("llc-cash", 40_000, {
      parentAccountId: "biz-llc",
      owners: [],
    });
    const r = computeGrossEstate({
      deceased: "client",
      deathOrder: 1,
      accounts: [llcAccount, childCash],
      accountBalances: { "biz-llc": 250_000, "llc-cash": 40_000 },
      liabilities: [],
      entities: [],
      deceasedFmId: LEGACY_FM_CLIENT,
      survivorFmId: LEGACY_FM_SPOUSE,
    });
    // Consolidated business line: 250k flat + 40k child = 290k.
    const bizLine = r.lines.find((l) => l.accountId === "biz-llc" && l.entityId === null);
    expect(bizLine).toBeDefined();
    expect(bizLine!.amount).toBeCloseTo(290_000, 2);
  });

  it("consolidates a business: flat value + 100%-owned child account into one line", () => {
    // Test Bus LLC ($10k flat) owns "Test Bus — Cash" via parentAccountId
    // ($5k). Client owns the LLC 100%. Separate family savings account is
    // unrelated. (The legacy fixture's "20% slice of a mixed account" via
    // kind:"entity" owner is no longer supported under the new account
    // model — that cross-ownership path was removed.)
    const llcAccount: Account = {
      id: "biz-llc",
      name: "Test Bus",
      category: "business",
      subType: "llc",
      value: 10_000,
      basis: 0,
      businessType: "llc",
      parentAccountId: null,
      growthRate: 0,
      rmdEnabled: false,
      titlingType: "jtwros",
      owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    };
    const llcCash = acct("llc-cash", 5_000, {
      parentAccountId: "biz-llc",
      owners: [],
    });
    const savings = acct("savings", 100_000, {
      owners: [
        { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 },
      ],
    });
    const r = computeGrossEstate({
      deceased: "client",
      deathOrder: 1,
      accounts: [llcAccount, llcCash, savings],
      accountBalances: { "biz-llc": 10_000, "llc-cash": 5_000, savings: 100_000 },
      liabilities: [],
      entities: [],
      deceasedFmId: LEGACY_FM_CLIENT,
      survivorFmId: LEGACY_FM_SPOUSE,
    });

    // Family savings account line: 100% of $100k.
    const savingsLine = r.lines.find((l) => l.accountId === "savings");
    expect(savingsLine!.amount).toBeCloseTo(100_000, 2);
    // One consolidated business line: $10k flat + $5k child = $15k.
    const bizLine = r.lines.find((l) => l.accountId === "biz-llc" && l.entityId === null);
    expect(bizLine).toBeDefined();
    expect(bizLine!.amount).toBeCloseTo(15_000, 2);
  });

  it("excludes a 100%-revocable-trust account when the deceased is NOT the grantor", () => {
    // Spouse is the grantor; client dies. The sole-entity early-out's
    // `ent.grantor !== input.deceased` guard must fire — distinct from the
    // irrevocable-trust path. Total = 0.
    const spouseRev: EntitySummary = {
      id: "spouse-rev",
      includeInPortfolio: true,
      isGrantor: true,
      isIrrevocable: false,
      grantor: "spouse",
    };
    const r = computeGrossEstate({
      deceased: "client",
      deathOrder: 1,
      accounts: [acct("rev-spouse", 400_000, {
        owners: [{ kind: "entity", entityId: "spouse-rev", percent: 1 }],
      })],
      accountBalances: { "rev-spouse": 400_000 },
      liabilities: [],
      entities: [spouseRev],
      deceasedFmId: LEGACY_FM_CLIENT,
      survivorFmId: LEGACY_FM_SPOUSE,
    });
    expect(r.total).toBe(0);
    expect(r.lines).toEqual([]);
  });
});

describe("computeDeductions", () => {
  function transfer(overrides: Partial<DeathTransfer>): DeathTransfer {
    return {
      year: 2030,
      deathOrder: 1,
      deceased: "client",
      sourceAccountId: "a1",
      sourceAccountName: "Account a1",
      sourceLiabilityId: null,
      sourceLiabilityName: null,
      via: "will",
      recipientKind: "family_member",
      recipientId: "fm1",
      recipientLabel: "Child",
      amount: 0,
      basis: 0,
      resultingAccountId: null,
      resultingLiabilityId: null,
      ...overrides,
    };
  }
  const planSettings: Partial<PlanSettings> = { estateAdminExpenses: 3_900, flatStateEstateRate: 0 };

  it("marital deduction = sum of spouse-routed transfer amounts at first death", () => {
    const ledger = [
      transfer({ recipientKind: "spouse", amount: 200_000 }),
      transfer({ recipientKind: "family_member", amount: 50_000 }),
    ];
    const r = computeDeductions({
      transferLedger: ledger,
      externalBeneficiaries: [],
      planSettings: planSettings as PlanSettings,
      deathOrder: 1,
    });
    expect(r.maritalDeduction).toBeCloseTo(200_000, 2);
    expect(r.charitableDeduction).toBe(0);
    expect(r.estateAdminExpenses).toBe(3_900);
  });

  it("marital deduction is 0 at final death", () => {
    const ledger = [transfer({ recipientKind: "spouse", amount: 200_000 })];
    const r = computeDeductions({
      transferLedger: ledger,
      externalBeneficiaries: [],
      planSettings: planSettings as PlanSettings,
      deathOrder: 2,
    });
    expect(r.maritalDeduction).toBe(0);
  });

  it("marital deduction nets out encumbrances on spouse-routed assets (§2056(b)(4)(B))", () => {
    // Spouse inherits a $950k home with a $600k mortgage and a $750k account
    // with no liability. Marital deduction = (950k - 600k) + 750k = $1.1M.
    const ledger = [
      transfer({
        recipientKind: "spouse",
        amount: 950_000,
        resultingAccountId: "homeAfter",
      }),
      transfer({
        recipientKind: "spouse",
        amount: 750_000,
        resultingAccountId: "schwabAfter",
      }),
    ];
    const resultingLiabilities: Liability[] = [
      {
        id: "mortgageAfter",
        name: "Home Mortgage",
        balance: 600_000,
        interestRate: 0.04,
        monthlyPayment: 0,
        startYear: 2020,
        startMonth: 1,
        termMonths: 360,
        extraPayments: [],
        isInterestDeductible: true,
        owners: [],
        linkedPropertyId: "homeAfter",
      },
    ];
    const r = computeDeductions({
      transferLedger: ledger,
      externalBeneficiaries: [],
      planSettings: planSettings as PlanSettings,
      deathOrder: 1,
      resultingLiabilities,
    });
    expect(r.maritalDeduction).toBeCloseTo(1_100_000, 2);
  });

  it("F8: scales encumbrance to the decedent's includible share (§2056(b)(4)(B))", () => {
    // JTWROS home: $1M ledger amount routes 100% to survivor by right of
    // survivorship, but only the decedent's 50% ($500k) is includible in the
    // gross estate. A $600k mortgage follows the asset. §2056(b)(4)(B) reduces
    // the marital deduction only to the extent the encumbrance burdens the
    // INCLUDIBLE interest: 600k × (500k/1M) = 300k. Marital = 500k − 300k = 200k.
    const ledger = [
      transfer({
        recipientKind: "spouse",
        via: "titling",
        sourceAccountId: "home-1",
        amount: 1_000_000,
        resultingAccountId: "home-1-to-spouse",
      }),
    ];
    const grossEstateLines: GrossEstateLine[] = [
      {
        label: "JTWROS Home (50%)",
        accountId: "home-1",
        liabilityId: null,
        percentage: 0.5,
        amount: 500_000,
        isProbate: false,
      },
    ];
    const resultingLiabilities: Liability[] = [
      {
        id: "mortgage-1",
        name: "Home Mortgage",
        balance: 600_000,
        interestRate: 0.04,
        monthlyPayment: 0,
        startYear: 2020,
        startMonth: 1,
        termMonths: 360,
        extraPayments: [],
        isInterestDeductible: true,
        owners: [],
        linkedPropertyId: "home-1-to-spouse",
      },
    ];
    const r = computeDeductions({
      transferLedger: ledger,
      grossEstateLines,
      externalBeneficiaries: [],
      planSettings: planSettings as PlanSettings,
      deathOrder: 1,
      resultingLiabilities,
    });
    expect(r.maritalDeduction).toBe(200_000);
  });

  it("marital deduction nets out unlinked debts assumed by spouse via default-order chain", () => {
    // Spouse inherits $1,125,000 of gross assets and assumes a $10,000
    // unlinked household debt via the default-order chain. Without netting,
    // the $10k would deduct twice (Schedule K -> gross estate AND marital
    // passes through gross-of-debt). Marital deduction = $1,115,000.
    const ledger = [
      transfer({ recipientKind: "spouse", amount: 1_125_000 }),
      transfer({
        recipientKind: "spouse",
        sourceAccountId: null,
        sourceLiabilityId: "liab-loan",
        sourceLiabilityName: "Loan",
        via: "unlinked_liability_proportional",
        amount: -10_000,
      }),
    ];
    const r = computeDeductions({
      transferLedger: ledger,
      externalBeneficiaries: [],
      planSettings: planSettings as PlanSettings,
      deathOrder: 1,
    });
    expect(r.maritalDeduction).toBeCloseTo(1_115_000, 2);
  });

  it("does not let unlinked debt push marital deduction below 0", () => {
    const ledger = [
      transfer({ recipientKind: "spouse", amount: 5_000 }),
      transfer({
        recipientKind: "spouse",
        sourceAccountId: null,
        sourceLiabilityId: "liab-loan",
        sourceLiabilityName: "Loan",
        via: "unlinked_liability_proportional",
        amount: -10_000,
      }),
    ];
    const r = computeDeductions({
      transferLedger: ledger,
      externalBeneficiaries: [],
      planSettings: planSettings as PlanSettings,
      deathOrder: 1,
    });
    expect(r.maritalDeduction).toBe(0);
  });

  it("caps marital deduction at decedent's gross-estate share for joint-titled accounts (§2056)", () => {
    // Joint cash account: $107,346 total. At first death, only 50% ($53,673)
    // is in the deceased's gross estate; the survivor's pre-existing 50% never
    // belonged to the decedent and can't qualify for the marital deduction.
    // The titling chain still routes the FULL $107,346 to the survivor (right
    // of survivorship), so the ledger entry shows the gross transfer amount.
    // Without this cap, the marital deduction would over-deduct $53,673 and
    // push taxable estate below what actually passed to non-spouse heirs.
    const ledger = [
      transfer({
        recipientKind: "spouse",
        via: "titling",
        sourceAccountId: "joint-cash",
        amount: 107_346,
      }),
    ];
    const grossEstateLines: GrossEstateLine[] = [
      {
        label: "Joint Cash (50%)",
        accountId: "joint-cash",
        liabilityId: null,
        percentage: 0.5,
        amount: 53_673,
        isProbate: false,
      },
    ];
    const r = computeDeductions({
      transferLedger: ledger,
      grossEstateLines,
      externalBeneficiaries: [],
      planSettings: planSettings as PlanSettings,
      deathOrder: 1,
    });
    expect(r.maritalDeduction).toBeCloseTo(53_673, 2);
  });

  it("covers a spouse-routed business transfer with the marital deduction", () => {
    // Business entity "e1" has $30k in the gross estate. The ledger routes
    // $30k to the spouse (fallback_spouse). The marital deduction must be
    // capped at the gross-estate amount ($30k), not the full transfer amount.
    // This also verifies that entity-sourced transfers (sourceAccountId=null,
    // sourceEntityId set) aren't ignored by the account-cap branch.
    const grossEstateLines: GrossEstateLine[] = [
      {
        label: "Test Bus (Business)",
        accountId: null,
        liabilityId: null,
        entityId: "e1",
        percentage: 1,
        amount: 30_000,
        isProbate: false,
      },
    ];
    const transferLedger: DeathTransfer[] = [
      {
        year: 2030,
        deathOrder: 1,
        deceased: "client",
        sourceAccountId: null,
        sourceAccountName: "Test Bus",
        sourceLiabilityId: null,
        sourceLiabilityName: null,
        sourceEntityId: "e1",
        via: "fallback_spouse",
        recipientKind: "spouse",
        recipientId: "fmSpouse",
        recipientLabel: "Spouse",
        amount: 30_000,
        basis: 10_000,
        resultingAccountId: null,
        resultingLiabilityId: null,
      },
    ];
    const d = computeDeductions({
      transferLedger,
      externalBeneficiaries: [],
      planSettings: planSettings as PlanSettings,
      deathOrder: 1,
      grossEstateLines,
    });
    expect(d.maritalDeduction).toBe(30_000);
  });

  it("caps marital deduction at gross-estate share for a spouse-routed business transfer (§2056)", () => {
    // Business "e1": gross estate shows $30k (deceased's 60% share of entity).
    // Transfer ledger routes $50k to spouse — this shouldn't happen in normal
    // operation, but the cap must prevent over-claiming the marital deduction
    // beyond what actually passed from the decedent. Without grossByEntityId,
    // eligible = t.amount = $50k and maritalDeduction = $50k (over-claimed).
    const grossEstateLines: GrossEstateLine[] = [
      {
        label: "Test Bus (Business) (60%)",
        accountId: null,
        liabilityId: null,
        entityId: "e1",
        percentage: 0.6,
        amount: 30_000,
        isProbate: false,
      },
    ];
    const transferLedger: DeathTransfer[] = [
      {
        year: 2030,
        deathOrder: 1,
        deceased: "client",
        sourceAccountId: null,
        sourceAccountName: "Test Bus",
        sourceLiabilityId: null,
        sourceLiabilityName: null,
        sourceEntityId: "e1",
        via: "fallback_spouse",
        recipientKind: "spouse",
        recipientId: "fmSpouse",
        recipientLabel: "Spouse",
        amount: 50_000,
        basis: 10_000,
        resultingAccountId: null,
        resultingLiabilityId: null,
      },
    ];
    const d = computeDeductions({
      transferLedger,
      externalBeneficiaries: [],
      planSettings: planSettings as PlanSettings,
      deathOrder: 1,
      grossEstateLines,
    });
    expect(d.maritalDeduction).toBe(30_000);
  });

  it("charitable deduction = sum of external_beneficiary transfers whose kind is charity", () => {
    const ledger = [
      transfer({ recipientKind: "external_beneficiary", recipientId: "eb1", amount: 50_000 }),
      transfer({ recipientKind: "external_beneficiary", recipientId: "eb2", amount: 25_000 }),
    ];
    const externals = [
      { id: "eb1", name: "Red Cross", kind: "charity" as const },
      { id: "eb2", name: "Nephew Bob", kind: "individual" as const },
    ];
    const r = computeDeductions({
      transferLedger: ledger,
      externalBeneficiaries: externals,
      planSettings: planSettings as PlanSettings,
      deathOrder: 1,
    });
    expect(r.charitableDeduction).toBeCloseTo(50_000, 2);
  });

  it("adds the survivor-annuity deemed-QTIP marital deduction at first death", () => {
    const r = computeDeductions({
      transferLedger: [transfer({ recipientKind: "spouse", amount: 200_000 })],
      externalBeneficiaries: [],
      planSettings: planSettings as PlanSettings,
      deathOrder: 1,
      survivorAnnuityMaritalDeduction: 100_000,
    });
    expect(r.maritalDeduction).toBeCloseTo(300_000, 2);
  });

  it("ignores the survivor-annuity marital deduction at final death", () => {
    const r = computeDeductions({
      transferLedger: [],
      externalBeneficiaries: [],
      planSettings: planSettings as PlanSettings,
      deathOrder: 2,
      survivorAnnuityMaritalDeduction: 100_000,
    });
    expect(r.maritalDeduction).toBe(0);
  });
});

// Bug #5 — Marital deduction must NOT be denied when the surviving spouse is
// named on a beneficiary designation by their explicit FamilyMember id
// (familyMemberId), rather than by householdRole:"spouse". Before the fix,
// applyBeneficiaryDesignations tagged the transfer recipientKind:"family_member"
// for the familyMemberId case, so the unlimited IRC §2056 marital deduction was
// $0 and the asset stayed fully taxable (phantom estate tax). The control case
// (householdRole:"spouse") was already correct; both must now produce parity.
describe("Bug #5 — spouse-by-familyMemberId beneficiary earns the marital deduction", () => {
  const FMS: FamilyMember[] = [
    { id: LEGACY_FM_CLIENT, role: "client", relationship: "other", firstName: "Pat", lastName: null, dateOfBirth: "1970-01-01" },
    { id: LEGACY_FM_SPOUSE, role: "spouse", relationship: "other", firstName: "Sam", lastName: null, dateOfBirth: "1972-01-01" },
  ];

  const PLAN: PlanSettings = {
    flatFederalRate: 0,
    flatStateRate: 0,
    inflationRate: 0,
    planStartYear: 2026,
    planEndYear: 2080,
    estateAdminExpenses: 0,
    flatStateEstateRate: 0,
  } as PlanSettings;

  function brokerageWithPrimaryBene(
    bene: { familyMemberId?: string; householdRole?: "client" | "spouse" },
  ): Account {
    return {
      id: "acc-brokerage",
      name: "Brokerage",
      category: "taxable",
      subType: "brokerage",
      value: 5_000_000,
      basis: 5_000_000,
      growthRate: 0,
      rmdEnabled: false,
      owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
      beneficiaries: [
        { id: "b1", tier: "primary", percentage: 100, sortOrder: 0, ...bene },
      ],
    } as Account;
  }

  function mkInput(account: Account): DeathEventInput {
    return {
      year: 2026,
      deceased: "client",
      survivor: "spouse",
      will: null,
      incomes: [],
      liabilities: [],
      familyMembers: FMS,
      externalBeneficiaries: [],
      entities: [],
      planSettings: PLAN,
      gifts: [],
      annualExclusionsByYear: {},
      dsueReceived: 0,
      priorTaxableGifts: { client: 0, spouse: 0 },
      accounts: [account],
      accountBalances: { [account.id]: account.value },
      basisMap: { [account.id]: account.basis },
    } as DeathEventInput;
  }

  it("names the survivor by familyMemberId: maritalDeduction = full value, taxableEstate = 0", () => {
    const result = applyFirstDeath(
      mkInput(brokerageWithPrimaryBene({ familyMemberId: LEGACY_FM_SPOUSE })),
    );

    const beneTransfer = result.transfers.find(
      (t) => t.via === "beneficiary_designation" && t.sourceAccountId === "acc-brokerage",
    );
    expect(beneTransfer).toBeDefined();
    expect(beneTransfer!.recipientKind).toBe("spouse");
    expect(beneTransfer!.recipientId).toBe(LEGACY_FM_SPOUSE);

    expect(result.estateTax.maritalDeduction).toBeCloseTo(5_000_000, 2);
    expect(result.estateTax.taxableEstate).toBe(0);
  });

  it("control — names the survivor by householdRole:\"spouse\": same result (parity)", () => {
    const result = applyFirstDeath(
      mkInput(brokerageWithPrimaryBene({ householdRole: "spouse" })),
    );

    const beneTransfer = result.transfers.find(
      (t) => t.via === "beneficiary_designation" && t.sourceAccountId === "acc-brokerage",
    );
    expect(beneTransfer).toBeDefined();
    expect(beneTransfer!.recipientKind).toBe("spouse");

    expect(result.estateTax.maritalDeduction).toBeCloseTo(5_000_000, 2);
    expect(result.estateTax.taxableEstate).toBe(0);
  });
});
