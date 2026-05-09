import { describe, it, expect } from "vitest";
import {
  computeFederalEstateTax,
  computeDeductions,
  computeGrossEstate,
} from "../estate-tax";
import type {
  Account, Liability, DeathTransfer, EntitySummary, GrossEstateLine, PlanSettings,
} from "../../types";
import { LEGACY_FM_CLIENT, LEGACY_FM_SPOUSE } from "../../ownership";

describe("computeFederalEstateTax", () => {
  it("reproduces the Form 706 screenshot walkthrough (zero tax, simplified DSUE)", () => {
    const r = computeFederalEstateTax({
      taxableEstate: 50_000,
      adjustedTaxableGifts: 14_000_000,
      lifetimeGiftTaxAdjustment: 0,
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
      lifetimeGiftTaxAdjustment: 0,
      beaAtDeathYear: 15_000_000,
      dsueReceived: 5_000_000,
    });
    expect(r.federalEstateTax).toBeCloseTo(2_000_000, 2);
  });

  it("clamps federal tax at zero for small estates", () => {
    const r = computeFederalEstateTax({
      taxableEstate: 100_000,
      adjustedTaxableGifts: 0,
      lifetimeGiftTaxAdjustment: 0,
      beaAtDeathYear: 15_000_000,
      dsueReceived: 0,
    });
    expect(r.federalEstateTax).toBe(0);
  });

  it("applies DSUE additively to BEA for the applicable exclusion", () => {
    const r = computeFederalEstateTax({
      taxableEstate: 20_000_000,
      adjustedTaxableGifts: 0,
      lifetimeGiftTaxAdjustment: 0,
      beaAtDeathYear: 15_000_000,
      dsueReceived: 10_000_000,
    });
    expect(r.applicableExclusion).toBe(25_000_000);
    expect(r.federalEstateTax).toBe(0);
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
    expect(r.total).toBeCloseTo(310_500, 2);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].percentage).toBe(0.5);
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
    expect(r.total).toBeCloseTo(621_000, 2);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].percentage).toBe(1);
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
});
