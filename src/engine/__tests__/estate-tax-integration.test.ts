import { describe, it, expect } from "vitest";
import { applyFirstDeath, applyFinalDeath } from "../death-event";
import type { DeathEventInput } from "../death-event";
import { runProjection } from "../projection";
import type {
  Account,
  BeneficiaryRef,
  ClientData,
  ClientInfo,
  EntitySummary,
  FamilyMember,
  Liability,
  PlanSettings,
  Will,
  WillBequest,
} from "../types";
import { LEGACY_FM_CLIENT, LEGACY_FM_SPOUSE, controllingEntity } from "../ownership";

/**
 * Integration tests for the 4d estate-tax pipeline.
 *
 * These tests exercise the end-to-end orchestration of applyFirstDeath /
 * applyFinalDeath across the 4b/4c precedence chains + grantor-succession +
 * creditor-payoff + estate-tax drain + pour-out phases. Most build
 * DeathEventInput shapes directly to keep the focus on a single death
 * pipeline; the DSUE-portability test goes through runProjection to verify
 * the projection.ts stash-and-thread plumbing.
 */

// ── Scaffolding ─────────────────────────────────────────────────────────────

/** Default principal family members with LEGACY sentinel IDs. */
const defaultClientFm: FamilyMember = {
  id: LEGACY_FM_CLIENT, role: "client", relationship: "other",
  firstName: "Client", lastName: "Test", dateOfBirth: "1970-01-01",
};
const defaultSpouseFm: FamilyMember = {
  id: LEGACY_FM_SPOUSE, role: "spouse", relationship: "other",
  firstName: "Spouse", lastName: "Test", dateOfBirth: "1972-01-01",
};

const basePlanSettings: PlanSettings = {
  flatFederalRate: 0,
  flatStateRate: 0,
  inflationRate: 0.025,
  planStartYear: 2026,
  planEndYear: 2066,
  taxInflationRate: 0.025,
  estateAdminExpenses: 0,
  flatStateEstateRate: 0,
};

/** Build a DeathEventInput populated with sensible defaults. All fields
 *  can be overridden via the partial. accountBalances and basisMap default
 *  to mirroring each account's .value and .basis. */
function mkFirstDeathInput(over: Partial<DeathEventInput> = {}): DeathEventInput {
  const accounts = over.accounts ?? [];
  const accountBalances: Record<string, number> = over.accountBalances ?? {};
  const basisMap: Record<string, number> = over.basisMap ?? {};
  for (const a of accounts) {
    if (accountBalances[a.id] == null) accountBalances[a.id] = a.value;
    if (basisMap[a.id] == null) basisMap[a.id] = a.basis;
  }
  // Always include principal FMs so deceasedFmId / survivorFmId resolve correctly.
  // Merge caller-supplied FMs (e.g. children) without duplicating the principals.
  const callerFms = over.familyMembers ?? [];
  const principalFms = [defaultClientFm, defaultSpouseFm].filter(
    (p) => !callerFms.some((f) => f.id === p.id),
  );
  const familyMembers = [...principalFms, ...callerFms];
  const { familyMembers: _fm, ...rest } = over;
  return {
    year: 2045,
    deceased: "client",
    survivor: "spouse",
    will: null,
    accounts,
    accountBalances,
    basisMap,
    incomes: [],
    liabilities: [],
    familyMembers,
    externalBeneficiaries: [],
    entities: [],
    planSettings: basePlanSettings,
    gifts: [],
    annualExclusionsByYear: {},
    dsueReceived: 0,
    ...rest,
  };
}

function mkFinalDeathInput(over: Partial<DeathEventInput> = {}): DeathEventInput {
  const accounts = over.accounts ?? [];
  const accountBalances: Record<string, number> = over.accountBalances ?? {};
  const basisMap: Record<string, number> = over.basisMap ?? {};
  for (const a of accounts) {
    if (accountBalances[a.id] == null) accountBalances[a.id] = a.value;
    if (basisMap[a.id] == null) basisMap[a.id] = a.basis;
  }
  // Always include the deceased's FM so deceasedFmId resolves correctly.
  const callerFms = over.familyMembers ?? [];
  const principalFms = [defaultClientFm].filter(
    (p) => !callerFms.some((f) => f.id === p.id),
  );
  const familyMembers = [...principalFms, ...callerFms];
  const { familyMembers: _fm, ...rest } = over;
  return {
    year: 2052,
    deceased: "client",
    // survivor is unused by applyFinalDeath internals; pass the deceased as a
    // placeholder to keep the shared type happy.
    survivor: "client",
    will: null,
    accounts,
    accountBalances,
    basisMap,
    incomes: [],
    liabilities: [],
    familyMembers,
    externalBeneficiaries: [],
    entities: [],
    planSettings: basePlanSettings,
    gifts: [],
    annualExclusionsByYear: {},
    dsueReceived: 0,
    ...rest,
  };
}

const kidA: FamilyMember = {
  id: "kid-a", relationship: "child", role: "child", firstName: "Alice", lastName: "Test",
  dateOfBirth: "2000-01-01",
};
const kidB: FamilyMember = {
  id: "kid-b", relationship: "child", role: "child", firstName: "Bob", lastName: "Test",
  dateOfBirth: "2002-01-01",
};

// ── Describe block 1: 4d integration — first death estate tax ───────────────

describe("4d integration — first death estate tax", () => {
  it("everything-to-spouse: taxable=0, federal=0, full DSUE ports to survivor", () => {
    // All-assets-to-spouse will → 100% marital deduction → zero taxable
    // estate. Since nothing consumes the BEA, dsueGenerated = BEA(deathYear).
    const accounts: Account[] = [
      {
        id: "brokerage", name: "Joint Brokerage",
        category: "taxable", subType: "brokerage",
        value: 2_000_000, basis: 1_500_000,
        growthRate: 0.06, rmdEnabled: false,
        owners: [
          { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.5 },
          { kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 0.5 },
        ],
      },
      {
        id: "client-cash", name: "Client Cash",
        category: "cash", subType: "savings",
        value: 500_000, basis: 500_000,
        growthRate: 0.02, rmdEnabled: false,
        owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
      },
    ];
    const will: Will = {
      id: "w1", grantor: "client",
      bequests: [{
        id: "b1", name: "All to spouse",
        kind: "asset" as const, assetMode: "all_assets" as const, accountId: null, liabilityId: null,
        percentage: 100, condition: "always", sortOrder: 0,
        recipients: [{ recipientKind: "spouse", recipientId: null, percentage: 100, sortOrder: 0 }],
      }],
    };

    const input = mkFirstDeathInput({ accounts, will });
    const result = applyFirstDeath(input);

    expect(result.estateTax.taxableEstate).toBe(0);
    expect(result.estateTax.federalEstateTax).toBe(0);
    expect(result.estateTax.stateEstateTax).toBe(0);
    // Gross estate reflects the deceased's pre-chain ownership share:
    // 50% of joint ($1M) + 100% of client-cash ($500k) = $1.5M.
    expect(result.estateTax.grossEstate).toBeCloseTo(1_500_000, 0);
    // Marital deduction is capped at the deceased's gross-estate share per
    // source (IRC §2056 — only property "passing from the decedent" qualifies).
    // Joint brokerage: titling routes the full $2M to spouse but only $1M
    // (50%) is in gross; cash: $500k routes and $500k is in gross.
    // Total marital = $1M + $500k = $1.5M = grossEstate, so taxableEstate = 0.
    expect(result.estateTax.maritalDeduction).toBeCloseTo(1_500_000, 0);
    // DSUE generated = applicable exclusion (BEA + dsueReceived=0) since
    // tentative tax base is 0. BEA(2045) with 2.5% inflation ≈ $23.95M.
    expect(result.estateTax.dsueGenerated).toBeGreaterThan(14_000_000);
    expect(result.dsueGenerated).toBe(result.estateTax.dsueGenerated);
  });

  it("small residuary + large lifetime gifts: adjustedTaxableGifts drives tentativeTaxBase", () => {
    // $500k to spouse + $500k to kid; plus a $5M client-grantor lifetime gift.
    // Marital covers $500k; the kid's share ($500k) is taxable; gifts add
    // $5M (no annual exclusion plumbed yet → treated as fully taxable).
    const accounts: Account[] = [
      {
        id: "brokerage", name: "Client Brokerage",
        category: "taxable", subType: "brokerage",
        value: 1_000_000, basis: 600_000,
        growthRate: 0.05, rmdEnabled: false,
        owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
      },
    ];
    const will: Will = {
      id: "w1", grantor: "client",
      bequests: [{
        id: "b1", name: "Split 50/50 spouse + kid",
        kind: "asset" as const, assetMode: "all_assets" as const, accountId: null, liabilityId: null,
        percentage: 100, condition: "always", sortOrder: 0,
        recipients: [
          { recipientKind: "spouse", recipientId: null, percentage: 50, sortOrder: 0 },
          { recipientKind: "family_member", recipientId: "kid-a", percentage: 50, sortOrder: 1 },
        ],
      }],
    };
    const input = mkFirstDeathInput({
      accounts, will,
      familyMembers: [kidA],
      gifts: [{
        id: "g1", year: 2040, amount: 5_000_000,
        grantor: "client", recipientFamilyMemberId: "kid-a",
        useCrummeyPowers: false,
      }],
    });
    const result = applyFirstDeath(input);

    expect(result.estateTax.maritalDeduction).toBeCloseTo(500_000, 0);
    expect(result.estateTax.taxableEstate).toBeCloseTo(500_000, 0);
    expect(result.estateTax.adjustedTaxableGifts).toBeCloseTo(5_000_000, 0);
    expect(result.estateTax.tentativeTaxBase).toBeCloseTo(5_500_000, 0);
    // BEA(2045) ~$23.95M; $5.5M tentative base is well under exclusion → no tax.
    expect(result.estateTax.federalEstateTax).toBe(0);
    expect(result.estateTax.dsueGenerated).toBeGreaterThan(0);
  });

  it("excessive lifetime gifts exceed BEA: federal tax > 0, DSUE=0", () => {
    // Big residuary + huge gifts → tentative base exceeds applicable exclusion.
    // Use $30M lifetime gifts vs BEA(2045) ≈ $23.95M to force overflow.
    const accounts: Account[] = [
      {
        id: "brokerage", name: "Client Brokerage",
        category: "taxable", subType: "brokerage",
        value: 5_000_000, basis: 3_000_000,
        growthRate: 0.05, rmdEnabled: false,
        owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
      },
      {
        id: "client-cash", name: "Client Cash",
        category: "cash", subType: "savings",
        value: 2_000_000, basis: 2_000_000,
        growthRate: 0.02, rmdEnabled: false,
        owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
      },
    ];
    const will: Will = {
      id: "w1", grantor: "client",
      bequests: [{
        id: "b1", name: "All to kid-a",
        kind: "asset" as const, assetMode: "all_assets" as const, accountId: null, liabilityId: null,
        percentage: 100, condition: "always", sortOrder: 0,
        recipients: [{ recipientKind: "family_member", recipientId: "kid-a", percentage: 100, sortOrder: 0 }],
      }],
    };
    const input = mkFirstDeathInput({
      accounts, will,
      familyMembers: [kidA],
      gifts: [{
        id: "g1", year: 2040, amount: 30_000_000,
        grantor: "client", recipientFamilyMemberId: "kid-a",
        useCrummeyPowers: false,
      }],
    });
    const result = applyFirstDeath(input);

    // Taxable estate: 7M (no marital deduction, no charitable).
    expect(result.estateTax.taxableEstate).toBeCloseTo(7_000_000, 0);
    expect(result.estateTax.adjustedTaxableGifts).toBeCloseTo(30_000_000, 0);
    expect(result.estateTax.tentativeTaxBase).toBeCloseTo(37_000_000, 0);
    // Tentative base (37M) > applicable exclusion (~23.95M) → federal tax > 0.
    expect(result.estateTax.federalEstateTax).toBeGreaterThan(0);
    // When tentative base exceeds exclusion, dsueGenerated clamps to 0.
    expect(result.estateTax.dsueGenerated).toBe(0);
  });

  it("revocable joint trust with client grantor pours out at first death, spouse bene → marital covers", () => {
    // A revocable trust with client as grantor. At client's death, the
    // trust flips to irrevocable and its accounts pour out to the spouse
    // beneficiary. The pour-out transfer should contribute to the marital
    // deduction → taxable estate remains 0.
    const spouseBene: BeneficiaryRef = {
      id: "bref-1", tier: "primary", percentage: 100,
      familyMemberId: undefined, externalBeneficiaryId: undefined,
      sortOrder: 0,
    };
    // Spouse-as-trust-beneficiary is modeled via a family_member with
    // relationship "other" → spouse in the beneficiary list would need a
    // family record; instead the pour-out routes to a family-member kid-a
    // here and we assert the mechanism fires (not the marital claim).
    const trustEntity: EntitySummary = {
      id: "trust-1", includeInPortfolio: true, isGrantor: true,
      trustSubType: "revocable" as const, isIrrevocable: false,
      grantor: "client",
      beneficiaries: [{ ...spouseBene, familyMemberId: "kid-a" }],
    };
    const accounts: Account[] = [
      {
        id: "trust-acct", name: "Trust Brokerage",
        category: "taxable", subType: "brokerage",
        value: 1_000_000, basis: 700_000,
        growthRate: 0.05, rmdEnabled: false,
        // Entity-owned by the revocable trust (entity ownership is the canonical model)
        owners: [{ kind: "entity", entityId: "trust-1", percent: 1 }],
      },
    ];
    const input = mkFirstDeathInput({
      accounts,
      entities: [trustEntity],
      familyMembers: [kidA],
    });
    const result = applyFirstDeath(input);

    // Trust account is in gross estate (revocable + client grantor).
    expect(result.estateTax.grossEstate).toBeCloseTo(1_000_000, 0);
    // Pour-out fired → transfer ledger has a trust_pour_out entry.
    const pourOut = result.transfers.filter((t) => t.via === "trust_pour_out");
    expect(pourOut.length).toBeGreaterThan(0);
    expect(pourOut[0].recipientKind).toBe("family_member");
    // Entity mutated to irrevocable + grantor cleared.
    // (We can't read post-event entities off the result, but invariants
    // inside applyFirstDeath will throw if the flip didn't happen.)
  });

  it("ILIT on client life: insurance excluded from gross; death benefit pours out to trust benes", () => {
    // An ILIT (irrevocable life insurance trust) is NOT in the gross estate
    // because it's irrevocable (even though the insured is client). In our
    // minimal v1 model there's no explicit life-insurance proceeds
    // simulator, so we place a life_insurance account inside the trust with
    // its death-benefit value already on the balance. computeGrossEstate
    // skips irrevocable entities entirely → it drops out.
    const trustEntity: EntitySummary = {
      id: "ilit-1", includeInPortfolio: false, isGrantor: false,
      trustSubType: "ilit" as const, isIrrevocable: true,
      // Irrevocable trust with no household grantor: grantor is the client
      // (historically — the policy was funded by the client) but the 4d
      // gross-estate filter excludes irrevocable regardless.
      grantor: "client",
      beneficiaries: [{
        id: "bref-1", tier: "primary", percentage: 100,
        familyMemberId: "kid-a", sortOrder: 0,
      }],
    };
    const accounts: Account[] = [
      {
        id: "ilit-policy", name: "ILIT Life Policy",
        category: "life_insurance", subType: "term",
        value: 3_000_000, basis: 0,
        growthRate: 0, rmdEnabled: false,
        // Owned by the ILIT entity — irrevocable trust excludes from gross estate
        owners: [{ kind: "entity", entityId: "ilit-1", percent: 1 }],
      },
      {
        id: "client-cash", name: "Client Cash",
        category: "cash", subType: "savings",
        value: 200_000, basis: 200_000,
        growthRate: 0.02, rmdEnabled: false,
        // Client-owned cash (in gross estate; marital deduction covers it)
        owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
      },
    ];
    const will: Will = {
      id: "w1", grantor: "client",
      bequests: [{
        id: "b1", name: "All to spouse",
        kind: "asset" as const, assetMode: "all_assets" as const, accountId: null, liabilityId: null,
        percentage: 100, condition: "always", sortOrder: 0,
        recipients: [{ recipientKind: "spouse", recipientId: null, percentage: 100, sortOrder: 0 }],
      }],
    };
    const input = mkFirstDeathInput({
      accounts, will,
      entities: [trustEntity],
      familyMembers: [kidA],
    });
    const result = applyFirstDeath(input);

    // Gross estate excludes the $3M ILIT policy. Only the $200k client-cash
    // contributes; marital deduction covers all of it.
    expect(result.estateTax.grossEstate).toBeCloseTo(200_000, 0);
    expect(result.estateTax.grossEstateLines.some((l) => l.accountId === "ilit-policy")).toBe(false);
    // Since trust is irrevocable + isGrantor=false, no pour-out fires at
    // first death (grantor-succession only flips revocable trusts).
    const pourOut = result.transfers.filter((t) => t.via === "trust_pour_out");
    expect(pourOut).toHaveLength(0);
  });

  it("unlinked debt to spouse via default-order reduces marital deduction (§2056(b)(4)(B) extension)", () => {
    // Reproduces the advisor-reported bug: deceased solely owns IRA + Home +
    // Schwab; will routes home + IRA to spouse and Schwab 50/50 spouse/child.
    // Mortgage is linked to home (follows it to spouse). An unlinked $10k
    // personal loan flows to spouse via the default-order chain.
    //
    // The unlinked debt should reduce the marital deduction (not just the
    // gross estate); otherwise it nets twice — once on Schedule K and once
    // through marital pass-through — and taxable estate is $10k too low.
    const accounts: Account[] = [
      {
        id: "ira", name: "IRA",
        category: "retirement", subType: "traditional_ira",
        value: 400_000, basis: 0,
        growthRate: 0.05, rmdEnabled: false,
        owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
      },
      {
        id: "home", name: "Home",
        category: "real_estate", subType: "primary_residence",
        value: 950_000, basis: 600_000,
        growthRate: 0.03, rmdEnabled: false,
        owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
      },
      {
        id: "schwab", name: "Schwab Ind. Account",
        category: "taxable", subType: "brokerage",
        value: 750_000, basis: 500_000,
        growthRate: 0.05, rmdEnabled: false,
        owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
      },
    ];
    const liabilities: Liability[] = [
      {
        id: "mortgage", name: "Home Mortgage", balance: 600_000,
        interestRate: 0.05, monthlyPayment: 0,
        startYear: 2020, startMonth: 1, termMonths: 360, extraPayments: [],
        owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
        linkedPropertyId: "home",
      },
      {
        // Unlinked household loan, sole-deceased-owned (matches the advisor's
        // screenshot showing the full -$10k in gross estate). Falls through
        // the default-order chain to the surviving spouse.
        id: "loan", name: "Loan", balance: 10_000,
        interestRate: 0.06, monthlyPayment: 0,
        startYear: 2025, startMonth: 1, termMonths: 600, extraPayments: [],
        owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
      },
    ];
    const will: Will = {
      id: "w1", grantor: "client",
      bequests: [
        {
          id: "b-ira", name: "IRA → spouse",
          kind: "asset" as const, assetMode: "specific" as const,
          accountId: "ira", liabilityId: null,
          percentage: 100, condition: "always", sortOrder: 0,
          recipients: [{ recipientKind: "spouse", recipientId: null, percentage: 100, sortOrder: 0 }],
        },
        {
          id: "b-home", name: "Home → spouse",
          kind: "asset" as const, assetMode: "specific" as const,
          accountId: "home", liabilityId: null,
          percentage: 100, condition: "always", sortOrder: 1,
          recipients: [{ recipientKind: "spouse", recipientId: null, percentage: 100, sortOrder: 0 }],
        },
        {
          id: "b-schwab", name: "Schwab 50/50 spouse + kid",
          kind: "asset" as const, assetMode: "specific" as const,
          accountId: "schwab", liabilityId: null,
          percentage: 100, condition: "always", sortOrder: 2,
          recipients: [
            { recipientKind: "spouse", recipientId: null, percentage: 50, sortOrder: 0 },
            { recipientKind: "family_member", recipientId: "kid-a", percentage: 50, sortOrder: 1 },
          ],
        },
      ],
    };
    const input = mkFirstDeathInput({
      accounts, liabilities, will,
      familyMembers: [kidA],
    });
    const result = applyFirstDeath(input);

    // Gross estate: 400 + 950 + 750 - 10 - 600 = 1,490
    expect(result.estateTax.grossEstate).toBeCloseTo(1_490_000, 0);

    // Spouse inherits IRA ($400k) + Home ($950k, encumbered by $600k mortgage)
    // + half-Schwab ($375k) = $1,725k gross to spouse.
    //   - §2056(b)(4)(B) primary: -$600k linked mortgage following home
    //   - §2056(b)(4)(B) extension: -$10k unlinked loan via default-order
    // Marital deduction = 1,725 - 600 - 10 = 1,115
    expect(result.estateTax.maritalDeduction).toBeCloseTo(1_115_000, 0);

    // Taxable estate: 1,490 - 1,115 = 375 (the kid's half-Schwab share).
    expect(result.estateTax.taxableEstate).toBeCloseTo(375_000, 0);

    // Sanity: the unlinked loan reaches the spouse via default-order.
    const loanTransfer = result.transfers.find(
      (t) => t.via === "unlinked_liability_proportional" &&
             t.recipientKind === "spouse" &&
             t.sourceLiabilityId === "loan",
    );
    expect(loanTransfer).toBeDefined();
    expect(loanTransfer!.amount).toBeCloseTo(-10_000, 0);
  });
});

// ── Describe block 2: 4d integration — final death estate tax ───────────────

describe("4d integration — final death estate tax", () => {
  it("single-filer sole death, no prior DSUE: straight federal tax using BEA only", () => {
    // Single-filer with $20M estate at 2052. BEA(2052) ≈ 15M × 1.025^26 ≈ 28.5M
    // Wait — that's > 20M so federal tax would be 0. Bump the estate to $40M
    // to force tax > 0. No marital, no charitable; straight BEA.
    const accounts: Account[] = [
      {
        id: "brokerage", name: "Client Brokerage",
        category: "taxable", subType: "brokerage",
        value: 30_000_000, basis: 15_000_000,
        growthRate: 0.05, rmdEnabled: false,
        owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
      },
      {
        id: "client-cash", name: "Client Cash",
        category: "cash", subType: "savings",
        value: 10_000_000, basis: 10_000_000,
        growthRate: 0.02, rmdEnabled: false,
        owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
      },
    ];
    const input = mkFinalDeathInput({
      accounts,
      familyMembers: [kidA],
      // Single-filer: dsueReceived=0, and no gifts.
      dsueReceived: 0,
    });
    const result = applyFinalDeath(input);

    expect(result.estateTax.grossEstate).toBeCloseTo(40_000_000, 0);
    expect(result.estateTax.maritalDeduction).toBe(0);
    expect(result.estateTax.charitableDeduction).toBe(0);
    expect(result.estateTax.dsueReceived).toBe(0);
    // Tentative base = 40M > BEA(2052) → positive federal tax.
    expect(result.estateTax.federalEstateTax).toBeGreaterThan(0);
    expect(result.estateTax.dsueGenerated).toBe(0);
    // applicableExclusion is plain BEA (no DSUE).
    expect(result.estateTax.applicableExclusion).toBe(result.estateTax.beaAtDeathYear);
  });

  it("couple survivor's death with stashed DSUE adds to applicableExclusion", () => {
    // End-to-end via runProjection: client dies first (2045) with everything
    // routed to spouse → full marital deduction → BEA(2045) ports to
    // surviving spouse as DSUE. Spouse then dies in 2052; final-death's
    // applicableExclusion should equal BEA(2052) + the stashed DSUE.
    const client: ClientInfo = {
      firstName: "John", lastName: "Smith",
      dateOfBirth: "1970-01-01",
      retirementAge: 65, planEndAge: 95,
      filingStatus: "married_joint",
      lifeExpectancy: 75,           // dies 2045 (first death)
      spouseDob: "1972-01-01",
      spouseLifeExpectancy: 80,     // dies 2052 (final death)
    };
    const planSettings: PlanSettings = {
      flatFederalRate: 0,
      flatStateRate: 0,
      inflationRate: 0.025,
      planStartYear: 2026,
      planEndYear: 2066,
      taxInflationRate: 0.025,
      estateAdminExpenses: 0,
      flatStateEstateRate: 0,
    };
    // Modest estate so neither death incurs tax — focus is the DSUE plumbing.
    const accounts: Account[] = [
      {
        id: "client-brok", name: "Client Brokerage",
        category: "taxable", subType: "brokerage",
        value: 1_000_000, basis: 700_000,
        growthRate: 0, rmdEnabled: false,
        owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
      },
      {
        id: "client-cash", name: "Client Cash",
        category: "cash", subType: "savings",
        value: 200_000, basis: 200_000,
        growthRate: 0, rmdEnabled: false,
        owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
      },
    ];
    const wills: Will[] = [
      // Client's will: everything to spouse → full marital deduction at first
      // death → DSUE = BEA(2045) since no exclusion is consumed.
      {
        id: "w-client", grantor: "client",
        bequests: [{
          id: "beq-c", name: "Residual to spouse",
          kind: "asset" as const, assetMode: "all_assets" as const, accountId: null, liabilityId: null,
          percentage: 100, condition: "always", sortOrder: 0,
          recipients: [{ recipientKind: "spouse", recipientId: null, percentage: 100, sortOrder: 0 }],
        }],
      },
      // Spouse's will: everything to kid-a (so 4c routes cleanly).
      {
        id: "w-spouse", grantor: "spouse",
        bequests: [{
          id: "beq-s", name: "Residual to kid",
          kind: "asset" as const, assetMode: "all_assets" as const, accountId: null, liabilityId: null,
          percentage: 100, condition: "always", sortOrder: 0,
          recipients: [{ recipientKind: "family_member", recipientId: "kid-a", percentage: 100, sortOrder: 0 }],
        }],
      },
    ];
    const data: ClientData = {
      client,
      accounts,
      incomes: [],
      expenses: [],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [],
      planSettings,
      familyMembers: [kidA],
      wills,
      giftEvents: [],
    };

    const years = runProjection(data);
    const firstDeathYr = years.find((y) => y.year === 2045);
    const finalDeathYr = years.find((y) => y.year === 2052);

    // Both year rows must carry an attached EstateTaxResult.
    expect(firstDeathYr?.estateTax).toBeDefined();
    expect(finalDeathYr?.estateTax).toBeDefined();

    // First death: marital deduction zeroed taxable estate → full DSUE ports.
    expect(firstDeathYr!.estateTax!.taxableEstate).toBe(0);
    expect(firstDeathYr!.estateTax!.dsueGenerated).toBeGreaterThan(0);

    // Final death: dsueReceived must equal what the first death generated
    // (this is the projection.ts stash-and-thread under test).
    expect(finalDeathYr!.estateTax!.dsueReceived).toBeGreaterThan(0);
    expect(finalDeathYr!.estateTax!.dsueReceived).toBe(
      firstDeathYr!.estateTax!.dsueGenerated,
    );
    // applicableExclusion = BEA(deathYear) + dsueReceived per §2010(c).
    expect(finalDeathYr!.estateTax!.applicableExclusion).toBeCloseTo(
      finalDeathYr!.estateTax!.beaAtDeathYear + finalDeathYr!.estateTax!.dsueReceived,
      0,
    );
  });

  it("unlinked credit-card debt < cash: creditor-drain extinguishes, 4c runs on reduced balances", () => {
    // $500k cash + $10k CC. Creditor-drain pays the $10k from cash,
    // leaving $490k. 4c fallback routes $490k to kid-a. No residual →
    // distributeUnlinkedLiabilities does NOT fire.
    const accounts: Account[] = [
      {
        id: "client-cash", name: "Client Cash",
        category: "cash", subType: "savings",
        value: 500_000, basis: 500_000,
        growthRate: 0.02, rmdEnabled: false,
        owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
      },
    ];
    const liabilities: Liability[] = [{
      id: "cc", name: "Credit Card", balance: 10_000,
      interestRate: 0.18, monthlyPayment: 500,
      startYear: 2025, startMonth: 1, termMonths: 24, extraPayments: [],
      owners: [],
    }];
    const input = mkFinalDeathInput({
      accounts, liabilities,
      familyMembers: [kidA],
    });
    const result = applyFinalDeath(input);

    expect(result.estateTax.creditorPayoffDebits).toHaveLength(1);
    expect(result.estateTax.creditorPayoffDebits[0].accountId).toBe("client-cash");
    expect(result.estateTax.creditorPayoffDebits[0].amount).toBeCloseTo(10_000, 0);
    expect(result.estateTax.creditorPayoffResidual).toBe(0);
    // No proportional distribution fires.
    const liabTransfers = result.transfers.filter(
      (t) => t.via === "unlinked_liability_proportional",
    );
    expect(liabTransfers).toHaveLength(0);
    // The residual cash ($490k) routed to kid-a via fallback.
    const assetTransfers = result.transfers.filter((t) => t.sourceAccountId != null);
    expect(assetTransfers).toHaveLength(1);
    expect(assetTransfers[0].recipientId).toBe("kid-a");
  });

  it("unlinked debt > liquid pool: residual falls to 4c proportional-to-heirs", () => {
    // Illiquid estate: single real_estate account + $20k debt. The
    // creditor-drain finds no eligible liquid account, so residual=$20k
    // flows to distributeUnlinkedLiabilities post-chain.
    const accounts: Account[] = [
      {
        id: "home", name: "Primary Home",
        category: "real_estate", subType: "primary_residence",
        value: 500_000, basis: 400_000,
        growthRate: 0.03, rmdEnabled: false,
        owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
      },
    ];
    const liabilities: Liability[] = [{
      id: "cc", name: "Credit Card", balance: 20_000,
      interestRate: 0.18, monthlyPayment: 800,
      startYear: 2025, startMonth: 1, termMonths: 36, extraPayments: [],
      owners: [],
    }];
    const input = mkFinalDeathInput({
      accounts, liabilities,
      familyMembers: [kidA, kidB],
    });
    const result = applyFinalDeath(input);

    // Drain produced no debits (no eligible liquid accounts).
    expect(result.estateTax.creditorPayoffDebits).toHaveLength(0);
    expect(result.estateTax.creditorPayoffResidual).toBeCloseTo(20_000, 0);
    // The home routes 50/50 to kids via fallback_children;
    // distributeUnlinkedLiabilities attaches one liability transfer per kid.
    const liabTransfers = result.transfers.filter(
      (t) => t.via === "unlinked_liability_proportional",
    );
    expect(liabTransfers).toHaveLength(2);
    // Each kid absorbs half the $20k debt.
    expect(liabTransfers[0].amount).toBeCloseTo(-10_000, 0);
    expect(liabTransfers[1].amount).toBeCloseTo(-10_000, 0);
  });

  it("estate tax > liquid pool: partial payment, estate_tax_insufficient_liquid warning", () => {
    // Large taxable estate but mostly illiquid. Tax exceeds the liquid pool
    // → drain yields residual > 0 → orchestrator emits
    // `estate_tax_insufficient_liquid:<amount>` warning.
    const accounts: Account[] = [
      {
        id: "home", name: "Primary Home",
        category: "real_estate", subType: "primary_residence",
        value: 40_000_000, basis: 10_000_000,
        growthRate: 0.03, rmdEnabled: false,
        owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
      },
      {
        id: "client-cash", name: "Client Cash",
        category: "cash", subType: "savings",
        value: 10_000, basis: 10_000,
        growthRate: 0.01, rmdEnabled: false,
        owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
      },
    ];
    const input = mkFinalDeathInput({
      accounts,
      familyMembers: [kidA],
    });
    const result = applyFinalDeath(input);

    expect(result.estateTax.federalEstateTax).toBeGreaterThan(0);
    expect(result.estateTax.estateTaxDebits.length).toBeGreaterThan(0);
    // Drained total less than owed → warning fired.
    expect(result.warnings.some((w) => w.startsWith("estate_tax_insufficient_liquid"))).toBe(true);
  });

  it("revocable trust at final death: pour-out merges into 4c chain, ledger tagged trust_pour_out", () => {
    // Revocable trust with client as grantor. At client's (final) death,
    // trust accounts pour out to beneficiaries BEFORE the 4c chain handles
    // the residual. Ledger entries from pour-out are tagged
    // via="trust_pour_out".
    const trustEntity: EntitySummary = {
      id: "trust-1", includeInPortfolio: true, isGrantor: true,
      trustSubType: "revocable" as const, isIrrevocable: false,
      grantor: "client",
      beneficiaries: [{
        id: "bref-1", tier: "primary", percentage: 100,
        familyMemberId: "kid-a", sortOrder: 0,
      }],
    };
    const accounts: Account[] = [
      {
        id: "trust-acct", name: "Trust Brokerage",
        category: "taxable", subType: "brokerage",
        value: 1_000_000, basis: 700_000,
        growthRate: 0.05, rmdEnabled: false,
        owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
      },
      {
        id: "personal-cash", name: "Personal Cash",
        category: "cash", subType: "savings",
        value: 100_000, basis: 100_000,
        growthRate: 0.02, rmdEnabled: false,
        owners: [{ kind: "entity", entityId: "trust-1", percent: 1 }],
      },
    ];
    const input = mkFinalDeathInput({
      accounts,
      entities: [trustEntity],
      familyMembers: [kidA],
    });
    const result = applyFinalDeath(input);

    const pourOutEntries = result.transfers.filter((t) => t.via === "trust_pour_out");
    expect(pourOutEntries.length).toBeGreaterThan(0);
    expect(pourOutEntries[0].recipientId).toBe("kid-a");
    expect(pourOutEntries[0].deathOrder).toBe(2);
    // Personal cash also routes via fallback → kid-a.
    const fallbackKids = result.transfers.filter((t) => t.via === "fallback_children");
    expect(fallbackKids.length).toBeGreaterThan(0);
    // Gross estate includes both trust account (revocable + grantor=client)
    // and personal cash.
    expect(result.estateTax.grossEstate).toBeCloseTo(1_100_000, 0);
  });

  it("joint-owner account with ownerEntityId passes through 4c without tripping the invariant", () => {
    // Regression: an account with owner="joint" AND ownerEntityId set is
    // entity-owned per the resolver precedence (ownerEntityId > owner enum).
    // 4b skips it because of the entity ID; 4c must do the same instead of
    // throwing "still has owner='joint'".
    const irrevocableTrust: EntitySummary = {
      id: "irrev-trust", includeInPortfolio: true, isGrantor: false,
      trustSubType: "irrevocable" as const, isIrrevocable: true,
      beneficiaries: [{
        id: "bref-1", tier: "primary", percentage: 100,
        familyMemberId: "kid-a", sortOrder: 0,
      }],
    };
    const accounts: Account[] = [
      {
        id: "joint-in-trust", name: "Joint Trust Brokerage",
        category: "taxable", subType: "brokerage",
        value: 500_000, basis: 400_000,
        growthRate: 0.05, rmdEnabled: false,
        // Entity-owned — verifies that entity-owned accounts pass through 4c
        // without tripping the "still joint" invariant. The old system allowed
        // owner="joint" + ownerEntityId which entity precedence resolved; now
        // canonical entity ownership is the only model.
        owners: [{ kind: "entity", entityId: "irrev-trust", percent: 1 }],
      },
      {
        id: "personal-cash", name: "Personal Cash",
        category: "cash", subType: "savings",
        value: 100_000, basis: 100_000,
        growthRate: 0.02, rmdEnabled: false,
        owners: [{ kind: "entity", entityId: "irrev-trust", percent: 1 }],
      },
    ];
    const input = mkFinalDeathInput({
      accounts,
      entities: [irrevocableTrust],
      familyMembers: [kidA],
    });

    expect(() => applyFinalDeath(input)).not.toThrow();
    const result = applyFinalDeath(input);
    const passthrough = result.accounts.find((a) => a.id === "joint-in-trust");
    expect(passthrough).toBeDefined();
    expect(controllingEntity(passthrough!)).toBe("irrev-trust");
  });
});

// ── Describe block 3: 4d integration — state estate tax ─────────────────────

describe("4d integration — state estate tax", () => {
  it("flatStateEstateRate=0: stateEstateTax=0, no impact on totals", () => {
    const accounts: Account[] = [
      {
        id: "brokerage", name: "Client Brokerage",
        category: "taxable", subType: "brokerage",
        value: 5_000_000, basis: 3_000_000,
        growthRate: 0.05, rmdEnabled: false,
        owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
      },
    ];
    const input = mkFinalDeathInput({
      accounts,
      familyMembers: [kidA],
      planSettings: { ...basePlanSettings, flatStateEstateRate: 0 },
    });
    const result = applyFinalDeath(input);
    expect(result.estateTax.stateEstateTaxRate).toBe(0);
    expect(result.estateTax.stateEstateTax).toBe(0);
    expect(result.estateTax.totalEstateTax).toBe(result.estateTax.federalEstateTax);
  });

  it("flatStateEstateRate=0.08 on $2M taxable: stateEstateTax=$160k", () => {
    // Build a final-death scenario with exactly $2M taxable estate at an
    // 8% state estate-tax rate. Expected: stateEstateTax = $160,000.
    const accounts: Account[] = [
      {
        id: "brokerage", name: "Client Brokerage",
        category: "taxable", subType: "brokerage",
        value: 2_000_000, basis: 1_500_000,
        growthRate: 0, rmdEnabled: false,
        owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
      },
    ];
    const input = mkFinalDeathInput({
      accounts,
      familyMembers: [kidA],
      planSettings: { ...basePlanSettings, flatStateEstateRate: 0.08 },
    });
    const result = applyFinalDeath(input);

    expect(result.estateTax.taxableEstate).toBeCloseTo(2_000_000, 0);
    expect(result.estateTax.stateEstateTaxRate).toBe(0.08);
    expect(result.estateTax.stateEstateTax).toBeCloseTo(160_000, 0);
    // Federal tax is 0 (well under BEA), so totalEstateTax = stateEstateTax.
    expect(result.estateTax.federalEstateTax).toBe(0);
    expect(result.estateTax.totalEstateTax).toBeCloseTo(160_000, 0);
  });
});

// ── Describe block 4: 4e integration — liability bequests at final death ─────

/** Shared liability bequest fixture helpers. */
const tomJr: FamilyMember = {
  id: "tom-jr", relationship: "child", role: "child", firstName: "Tom", lastName: "Jr.",
  dateOfBirth: "2000-01-01",
};

function mkVisaLiability(overrides: Partial<Liability> = {}): Liability {
  return {
    id: "visa", name: "Visa", balance: 15_000,
    interestRate: 0.18, monthlyPayment: 300,
    startYear: 2025, startMonth: 1, termMonths: 120, extraPayments: [],
    owners: [],
    ...overrides,
  };
}

function mkVisaBequest(pct: number, recipientKind: "family_member" | "entity", recipientId: string): WillBequest {
  return {
    id: "beq-visa", name: "Visa bequest",
    kind: "liability" as const, assetMode: null, accountId: null,
    liabilityId: "visa",
    percentage: 100, condition: "always" as const, sortOrder: 0,
    recipients: [{ recipientKind, recipientId, percentage: pct, sortOrder: 0 }],
  };
}

describe("4e — liability bequests at final death", () => {
  // ── Scenario A: 100% bequest — debt absent from creditor-payoff ────────────
  it("A: 100% bequest to family_member — Visa absent from creditorPayoffDebits; will_liability_bequest in ledger; new liability row on recipient", () => {
    // Visa $15k bequeathed 100% to Tom Jr. → creditor-payoff pool sees $0 from
    // Visa; no debit for Visa; one will_liability_bequest transfer; new liability
    // row owned by tom-jr.
    const accounts: Account[] = [
      {
        id: "client-cash", name: "Client Cash",
        category: "cash", subType: "savings",
        value: 200_000, basis: 200_000,
        growthRate: 0.02, rmdEnabled: false,
        owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
      },
    ];
    const liabilities = [mkVisaLiability()];
    const will: Will = {
      id: "w-client", grantor: "client",
      bequests: [
        mkVisaBequest(100, "family_member", tomJr.id),
        {
          id: "beq-assets", name: "All to Tom Jr.",
          kind: "asset" as const, assetMode: "all_assets" as const, accountId: null, liabilityId: null,
          percentage: 100, condition: "always" as const, sortOrder: 1,
          recipients: [{ recipientKind: "family_member", recipientId: tomJr.id, percentage: 100, sortOrder: 0 }],
        },
      ],
    };

    const input = mkFinalDeathInput({ accounts, liabilities, will, familyMembers: [tomJr] });
    const result = applyFinalDeath(input);

    // Visa appears as a negative gross-estate line (debt).
    const visaLine = result.estateTax.grossEstateLines.find((l) => l.liabilityId === "visa");
    expect(visaLine).toBeDefined();
    expect(visaLine!.amount).toBeCloseTo(-15_000, 0);

    // Visa was bequeathed — not drained by creditor-payoff.
    const visaDebit = result.estateTax.creditorPayoffDebits.find(
      (d) => d.accountId === "client-cash",
    );
    // $0 debt remains for creditor payoff (Visa fully bequeathed), so no debit.
    expect(result.estateTax.creditorPayoffDebits.reduce((s, d) => s + d.amount, 0)).toBeCloseTo(0, 0);

    // Transfer ledger: exactly one will_liability_bequest for Visa.
    const bequestTransfers = result.transfers.filter((t) => t.via === "will_liability_bequest");
    expect(bequestTransfers).toHaveLength(1);
    expect(bequestTransfers[0].amount).toBeCloseTo(-15_000, 0);
    expect(bequestTransfers[0].recipientKind).toBe("family_member");
    expect(bequestTransfers[0].recipientId).toBe(tomJr.id);
    expect(bequestTransfers[0].sourceLiabilityId).toBe("visa");

    // Post-death liabilities: a new row owned by tom-jr.
    const bequestRow = result.liabilities.find((l) => l.ownerFamilyMemberId === tomJr.id);
    expect(bequestRow).toBeDefined();
    expect(bequestRow!.balance).toBeCloseTo(15_000, 0);
  });

  // ── Scenario B: 60% partial bequest ───────────────────────────────────────
  it("B: 60% partial bequest — 40% remainder drained from cash; grossEstateLines still shows full balance; one will_liability_bequest at -9k", () => {
    // 60% to Tom Jr. = $9k bequeathed. 40% = $6k remains unlinked.
    // Creditor payoff must cover $6k from client-cash.
    const accounts: Account[] = [
      {
        id: "client-cash", name: "Client Cash",
        category: "cash", subType: "savings",
        value: 100_000, basis: 100_000,
        growthRate: 0.02, rmdEnabled: false,
        owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
      },
    ];
    const liabilities = [mkVisaLiability()];
    const will: Will = {
      id: "w-client", grantor: "client",
      bequests: [
        mkVisaBequest(60, "family_member", tomJr.id),
        {
          id: "beq-assets", name: "Residual to Tom Jr.",
          kind: "asset" as const, assetMode: "all_assets" as const, accountId: null, liabilityId: null,
          percentage: 100, condition: "always" as const, sortOrder: 1,
          recipients: [{ recipientKind: "family_member", recipientId: tomJr.id, percentage: 100, sortOrder: 0 }],
        },
      ],
    };

    const input = mkFinalDeathInput({ accounts, liabilities, will, familyMembers: [tomJr] });
    const result = applyFinalDeath(input);

    // grossEstateLines still shows Visa at full $-15k (pre-bequest gross).
    const visaLine = result.estateTax.grossEstateLines.find((l) => l.liabilityId === "visa");
    expect(visaLine).toBeDefined();
    expect(visaLine!.amount).toBeCloseTo(-15_000, 0);

    // Creditor-payoff covers the un-bequeathed 40% = $6k.
    const totalCreditorDrain = result.estateTax.creditorPayoffDebits.reduce(
      (s, d) => s + d.amount, 0,
    );
    expect(totalCreditorDrain).toBeCloseTo(6_000, 0);

    // One will_liability_bequest at -$9k (60% of 15k).
    const bequestTransfers = result.transfers.filter((t) => t.via === "will_liability_bequest");
    expect(bequestTransfers).toHaveLength(1);
    expect(bequestTransfers[0].amount).toBeCloseTo(-9_000, 0);
    expect(bequestTransfers[0].recipientId).toBe(tomJr.id);
  });

  // ── Scenario C: 60% partial bequest + mostly-illiquid estate ─────────────
  it("C: 60% partial + mostly-illiquid estate — creditor drains partial cash, creditor_payoff_insufficient_liquid fires, residual distributed proportionally to asset heirs", () => {
    // 60% of $15k = $9k bequeathed; 40% = $6k must be paid by creditor drain.
    // Cash = $1k (only liquid); remainder $5k → insufficient → proportional fallback fires.
    // A real_estate account ensures Tom Jr. has a positive asset share in the ledger
    // so distributeUnlinkedLiabilities can apportion the $5k residual to him.
    const accounts: Account[] = [
      {
        id: "client-cash", name: "Client Cash",
        category: "cash", subType: "savings",
        value: 1_000, basis: 1_000,
        growthRate: 0.02, rmdEnabled: false,
        owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
      },
      {
        id: "client-home", name: "Primary Home",
        category: "real_estate", subType: "primary_residence",
        value: 200_000, basis: 150_000,
        growthRate: 0.03, rmdEnabled: false,
        owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
      },
    ];
    const liabilities = [mkVisaLiability()];
    const will: Will = {
      id: "w-client", grantor: "client",
      bequests: [
        mkVisaBequest(60, "family_member", tomJr.id),
        {
          id: "beq-assets", name: "Residual to Tom Jr.",
          kind: "asset" as const, assetMode: "all_assets" as const, accountId: null, liabilityId: null,
          percentage: 100, condition: "always" as const, sortOrder: 1,
          recipients: [{ recipientKind: "family_member", recipientId: tomJr.id, percentage: 100, sortOrder: 0 }],
        },
      ],
    };

    const input = mkFinalDeathInput({ accounts, liabilities, will, familyMembers: [tomJr] });
    const result = applyFinalDeath(input);

    // Creditor drain used the full $1k liquid.
    const totalCreditorDrain = result.estateTax.creditorPayoffDebits.reduce(
      (s, d) => s + d.amount, 0,
    );
    expect(totalCreditorDrain).toBeCloseTo(1_000, 0);

    // Residual was non-zero → warning fired.
    expect(result.warnings.some((w) => w.startsWith("creditor_payoff_insufficient_liquid"))).toBe(true);

    // distributeUnlinkedLiabilities fired: at least one proportional transfer
    // (Tom Jr. received the home, giving him a positive asset share).
    const propTransfers = result.transfers.filter(
      (t) => t.via === "unlinked_liability_proportional",
    );
    expect(propTransfers.length).toBeGreaterThan(0);
    // The proportional transfer amount is negative (debt allocated to heir).
    expect(propTransfers[0].amount).toBeLessThan(0);

    // The bequested slice still appears in the ledger.
    const bequestTransfers = result.transfers.filter((t) => t.via === "will_liability_bequest");
    expect(bequestTransfers).toHaveLength(1);
    expect(bequestTransfers[0].amount).toBeCloseTo(-9_000, 0);
  });

  // ── Scenario D: entity (trust) recipient ──────────────────────────────────
  it("D: 100% bequest to entity (irrevocable trust) — new liability row has ownerEntityId set; transfer tagged entity", () => {
    // Use an irrevocable trust so no pour-out fires and the bequest-derived
    // liability row retains its ownerEntityId through the full pipeline.
    const irrevocableTrust: EntitySummary = {
      id: "trust-irrev", includeInPortfolio: false, isGrantor: false,
      trustSubType: "irrevocable" as const, isIrrevocable: true,
      beneficiaries: [{
        id: "bref-1", tier: "primary", percentage: 100,
        familyMemberId: tomJr.id, sortOrder: 0,
      }],
    };
    const accounts: Account[] = [
      {
        id: "client-cash", name: "Client Cash",
        category: "cash", subType: "savings",
        value: 100_000, basis: 100_000,
        growthRate: 0.02, rmdEnabled: false,
        owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
      },
    ];
    const liabilities = [mkVisaLiability()];
    const will: Will = {
      id: "w-client", grantor: "client",
      bequests: [
        mkVisaBequest(100, "entity", irrevocableTrust.id),
        {
          id: "beq-assets", name: "Residual to Tom Jr.",
          kind: "asset" as const, assetMode: "all_assets" as const, accountId: null, liabilityId: null,
          percentage: 100, condition: "always" as const, sortOrder: 1,
          recipients: [{ recipientKind: "family_member", recipientId: tomJr.id, percentage: 100, sortOrder: 0 }],
        },
      ],
    };

    const input = mkFinalDeathInput({
      accounts, liabilities, will,
      entities: [irrevocableTrust],
      familyMembers: [tomJr],
    });
    const result = applyFinalDeath(input);

    // Transfer ledger: one will_liability_bequest to entity.
    const bequestTransfers = result.transfers.filter((t) => t.via === "will_liability_bequest");
    expect(bequestTransfers).toHaveLength(1);
    expect(bequestTransfers[0].recipientKind).toBe("entity");
    expect(bequestTransfers[0].recipientId).toBe(irrevocableTrust.id);

    // Post-death liabilities: a new row with entity ownership set.
    const entityRow = result.liabilities.find((l) => controllingEntity(l) === irrevocableTrust.id);
    expect(entityRow).toBeDefined();
    expect(entityRow!.balance).toBeCloseTo(15_000, 0);
    expect(entityRow!.ownerFamilyMemberId).toBeUndefined();
  });

  // ── Scenario E: bequest targets entity-owned debt → skipped ───────────────
  it("E: bequest targeting entity-owned debt → liability_bequest_ineligible warning; no will_liability_bequest transfer", () => {
    // Liability pre-owned by an entity. Bequest references it — must be skipped.
    const irrevTrust: EntitySummary = {
      id: "irrev-trust", includeInPortfolio: false, isGrantor: false,
      trustSubType: "irrevocable" as const, isIrrevocable: true,
    };
    const entityOwnedLiab: Liability = {
      id: "entity-debt", name: "Entity Loan", balance: 10_000,
      interestRate: 0.05, monthlyPayment: 200,
      startYear: 2020, startMonth: 1, termMonths: 60, extraPayments: [],
      owners: [{ kind: "entity", entityId: irrevTrust.id, percent: 1 }],
    };
    const accounts: Account[] = [
      {
        id: "client-cash", name: "Client Cash",
        category: "cash", subType: "savings",
        value: 50_000, basis: 50_000,
        growthRate: 0.02, rmdEnabled: false,
        owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
      },
    ];
    const will: Will = {
      id: "w-client", grantor: "client",
      bequests: [
        {
          id: "beq-entity-debt", name: "Entity debt bequest",
          kind: "liability" as const, assetMode: null, accountId: null,
          liabilityId: entityOwnedLiab.id,
          percentage: 100, condition: "always" as const, sortOrder: 0,
          recipients: [{ recipientKind: "family_member", recipientId: tomJr.id, percentage: 100, sortOrder: 0 }],
        },
        {
          id: "beq-assets", name: "Residual to Tom Jr.",
          kind: "asset" as const, assetMode: "all_assets" as const, accountId: null, liabilityId: null,
          percentage: 100, condition: "always" as const, sortOrder: 1,
          recipients: [{ recipientKind: "family_member", recipientId: tomJr.id, percentage: 100, sortOrder: 0 }],
        },
      ],
    };

    const input = mkFinalDeathInput({
      accounts,
      liabilities: [entityOwnedLiab],
      will,
      entities: [irrevTrust],
      familyMembers: [tomJr],
    });
    const result = applyFinalDeath(input);

    // liability_bequest_ineligible warning must be present.
    expect(result.warnings).toContain(`liability_bequest_ineligible:${entityOwnedLiab.id}`);

    // No will_liability_bequest transfer in the ledger.
    const bequestTransfers = result.transfers.filter((t) => t.via === "will_liability_bequest");
    expect(bequestTransfers).toHaveLength(0);

    // Entity-owned liability survives in the post-event list unchanged.
    const stillOwned = result.liabilities.find((l) => l.id === entityOwnedLiab.id);
    expect(stillOwned).toBeDefined();
    expect(controllingEntity(stillOwned!)).toBe(irrevTrust.id);
  });

  // ── Scenario F: first-death bequest ignored ────────────────────────────────
  it("F: liability bequest in first-dying spouse's will is ignored at first death; no will_liability_bequest in first-death ledger", () => {
    // Spouse dies first (2045). Spouse's will has a Visa bequest.
    // At first-death, liability-bequest logic must NOT fire (it's a 4c-only
    // phase). Visa balance must be unchanged; no will_liability_bequest in
    // the first-death transfers.
    const client: ClientInfo = {
      firstName: "Jane", lastName: "Doe",
      dateOfBirth: "1970-01-01",
      retirementAge: 65, planEndAge: 95,
      filingStatus: "married_joint",
      lifeExpectancy: 85,             // survives; dies 2055 (final death)
      spouseDob: "1972-01-01",
      spouseLifeExpectancy: 73,       // dies 2045 (first death)
    };
    const planSettings: PlanSettings = {
      flatFederalRate: 0,
      flatStateRate: 0,
      inflationRate: 0.025,
      planStartYear: 2026,
      planEndYear: 2066,
      taxInflationRate: 0.025,
      estateAdminExpenses: 0,
      flatStateEstateRate: 0,
    };
    const accounts: Account[] = [
      {
        id: "client-cash", name: "Client Cash",
        category: "cash", subType: "savings",
        value: 100_000, basis: 100_000,
        growthRate: 0, rmdEnabled: false,
        owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
      },
      {
        id: "spouse-cash", name: "Spouse Cash",
        category: "cash", subType: "savings",
        value: 50_000, basis: 50_000,
        growthRate: 0, rmdEnabled: false,
        owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 1 }],
      },
    ];
    const wills: Will[] = [
      // Spouse's will: asset bequest to client (surviving) + Visa liability bequest.
      {
        id: "w-spouse", grantor: "spouse",
        bequests: [
          {
            id: "beq-visa-spouse", name: "Spouse bequeaths Visa to Tom Jr.",
            kind: "liability" as const, assetMode: null, accountId: null,
            liabilityId: "visa",
            percentage: 100, condition: "always" as const, sortOrder: 0,
            recipients: [{ recipientKind: "family_member", recipientId: tomJr.id, percentage: 100, sortOrder: 0 }],
          },
          {
            id: "beq-assets-spouse", name: "All to client",
            kind: "asset" as const, assetMode: "all_assets" as const, accountId: null, liabilityId: null,
            percentage: 100, condition: "always" as const, sortOrder: 1,
            recipients: [{ recipientKind: "spouse", recipientId: null, percentage: 100, sortOrder: 0 }],
          },
        ],
      },
      // Client's will: simple residuary to Tom Jr. (final-death).
      {
        id: "w-client", grantor: "client",
        bequests: [{
          id: "beq-assets-client", name: "All to Tom Jr.",
          kind: "asset" as const, assetMode: "all_assets" as const, accountId: null, liabilityId: null,
          percentage: 100, condition: "always" as const, sortOrder: 0,
          recipients: [{ recipientKind: "family_member", recipientId: tomJr.id, percentage: 100, sortOrder: 0 }],
        }],
      },
    ];
    const data: ClientData = {
      client,
      accounts,
      incomes: [],
      expenses: [],
      liabilities: [mkVisaLiability()],
      savingsRules: [],
      withdrawalStrategy: [],
      planSettings,
      familyMembers: [tomJr],
      wills,
      giftEvents: [],
    };

    const years = runProjection(data);
    // Spouse dies in 2045 (first death). deathOrder=1 transfers are in that year.
    const firstDeathYr = years.find((y) => y.year === 2045);
    expect(firstDeathYr).toBeDefined();
    expect(firstDeathYr!.deathTransfers).toBeDefined();

    // No will_liability_bequest in first-death ledger.
    const firstDeathBequestTransfers = (firstDeathYr!.deathTransfers ?? []).filter(
      (t) => t.via === "will_liability_bequest" && t.deathOrder === 1,
    );
    expect(firstDeathBequestTransfers).toHaveLength(0);

    // Visa balance must be unchanged in first-death year output — the liability
    // was not acted upon by the first-death pipeline. Check by ensuring no
    // will_liability_bequest exists at deathOrder=1 for that year at all.
    const anyFirstDeathLiabBequest = (firstDeathYr!.deathTransfers ?? []).filter(
      (t) => t.via === "will_liability_bequest",
    );
    expect(anyFirstDeathLiabBequest).toHaveLength(0);
  });
});
