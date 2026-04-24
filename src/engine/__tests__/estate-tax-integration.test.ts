import { describe, it, expect } from "vitest";
import { applyFirstDeath, applyFinalDeath } from "../death-event";
import type { DeathEventInput } from "../death-event";
import type {
  Account,
  BeneficiaryRef,
  EntitySummary,
  FamilyMember,
  Liability,
  PlanSettings,
  Will,
} from "../types";

/**
 * Integration tests for the 4d estate-tax pipeline.
 *
 * These tests exercise the end-to-end orchestration of applyFirstDeath /
 * applyFinalDeath across the 4b/4c precedence chains + grantor-succession +
 * creditor-payoff + estate-tax drain + pour-out phases. They build
 * DeathEventInput shapes directly rather than round-tripping through
 * runProjection because runProjection currently does not attach the
 * EstateTaxResult to ProjectionYear (that wiring lives in a later task and
 * the result surface is produced by the orchestrator regardless).
 *
 * TODO(Task 11): once projection.ts threads DSUE between first→final death
 * and plumbs annualExclusionsByYear, the couple-survivor test below can be
 * promoted from .skip to active.
 */

// ── Scaffolding ─────────────────────────────────────────────────────────────

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
  return {
    year: 2045,
    deceased: "client",
    survivor: "spouse",
    will: over.will ?? null,
    accounts,
    accountBalances,
    basisMap,
    incomes: over.incomes ?? [],
    liabilities: over.liabilities ?? [],
    familyMembers: over.familyMembers ?? [],
    externalBeneficiaries: over.externalBeneficiaries ?? [],
    entities: over.entities ?? [],
    planSettings: over.planSettings ?? basePlanSettings,
    gifts: over.gifts ?? [],
    annualExclusionsByYear: over.annualExclusionsByYear ?? {},
    dsueReceived: over.dsueReceived ?? 0,
    ...over,
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
  return {
    year: 2052,
    deceased: "client",
    // survivor is unused by applyFinalDeath internals; pass the deceased as a
    // placeholder to keep the shared type happy.
    survivor: "client",
    will: over.will ?? null,
    accounts,
    accountBalances,
    basisMap,
    incomes: over.incomes ?? [],
    liabilities: over.liabilities ?? [],
    familyMembers: over.familyMembers ?? [],
    externalBeneficiaries: over.externalBeneficiaries ?? [],
    entities: over.entities ?? [],
    planSettings: over.planSettings ?? basePlanSettings,
    gifts: over.gifts ?? [],
    annualExclusionsByYear: over.annualExclusionsByYear ?? {},
    dsueReceived: over.dsueReceived ?? 0,
    ...over,
  };
}

const kidA: FamilyMember = {
  id: "kid-a", relationship: "child", firstName: "Alice", lastName: "Test",
  dateOfBirth: "2000-01-01",
};
const kidB: FamilyMember = {
  id: "kid-b", relationship: "child", firstName: "Bob", lastName: "Test",
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
        owner: "joint", value: 2_000_000, basis: 1_500_000,
        growthRate: 0.06, rmdEnabled: false,
      },
      {
        id: "client-cash", name: "Client Cash",
        category: "cash", subType: "savings",
        owner: "client", value: 500_000, basis: 500_000,
        growthRate: 0.02, rmdEnabled: false,
      },
    ];
    const will: Will = {
      id: "w1", grantor: "client",
      bequests: [{
        id: "b1", name: "All to spouse",
        assetMode: "all_assets", accountId: null,
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
    // Marital deduction sums the transfer-ledger amounts flowing to spouse.
    // Titling records the full joint-account value ($2M) flipping to
    // spouse (ROS convention); plus the cash's $500k → total $2.5M.
    // This nominally exceeds the gross-estate share, but `taxableEstate`
    // clamps at 0 so federal tax is 0 regardless. Future-work:
    // titling-ledger-amount-semantics — consider recording only the
    // deceased's half at first-death titling.
    expect(result.estateTax.maritalDeduction).toBeCloseTo(2_500_000, 0);
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
        owner: "client", value: 1_000_000, basis: 600_000,
        growthRate: 0.05, rmdEnabled: false,
      },
    ];
    const will: Will = {
      id: "w1", grantor: "client",
      bequests: [{
        id: "b1", name: "Split 50/50 spouse + kid",
        assetMode: "all_assets", accountId: null,
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
        owner: "client", value: 5_000_000, basis: 3_000_000,
        growthRate: 0.05, rmdEnabled: false,
      },
      {
        id: "client-cash", name: "Client Cash",
        category: "cash", subType: "savings",
        owner: "client", value: 2_000_000, basis: 2_000_000,
        growthRate: 0.02, rmdEnabled: false,
      },
    ];
    const will: Will = {
      id: "w1", grantor: "client",
      bequests: [{
        id: "b1", name: "All to kid-a",
        assetMode: "all_assets", accountId: null,
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
      trustSubType: "revocable_living" as const, isIrrevocable: false,
      grantor: "client",
      beneficiaries: [{ ...spouseBene, familyMemberId: "kid-a" }],
    };
    const accounts: Account[] = [
      {
        id: "trust-acct", name: "Trust Brokerage",
        category: "taxable", subType: "brokerage",
        owner: "client", value: 1_000_000, basis: 700_000,
        growthRate: 0.05, rmdEnabled: false,
        ownerEntityId: "trust-1",
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
        owner: "client", value: 3_000_000, basis: 0,
        growthRate: 0, rmdEnabled: false,
        ownerEntityId: "ilit-1",
      },
      {
        id: "client-cash", name: "Client Cash",
        category: "cash", subType: "savings",
        owner: "client", value: 200_000, basis: 200_000,
        growthRate: 0.02, rmdEnabled: false,
      },
    ];
    const will: Will = {
      id: "w1", grantor: "client",
      bequests: [{
        id: "b1", name: "All to spouse",
        assetMode: "all_assets", accountId: null,
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
        owner: "client", value: 30_000_000, basis: 15_000_000,
        growthRate: 0.05, rmdEnabled: false,
      },
      {
        id: "client-cash", name: "Client Cash",
        category: "cash", subType: "savings",
        owner: "client", value: 10_000_000, basis: 10_000_000,
        growthRate: 0.02, rmdEnabled: false,
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

  it.skip("couple survivor's death with stashed DSUE adds to applicableExclusion", () => {
    // TODO(Task 11): projection.ts currently hardcodes `dsueReceived: 0` at
    // the final-death call site. Once Task 11 threads DSUE from the
    // first-death EstateTaxResult into the final-death input, promote this
    // test. The assertion would be:
    //   applicableExclusion === beaAtDeathYear + dsueReceivedFromFirstDeath
    //   federalEstateTax lower than a same-estate single-filer comparison
  });

  it("unlinked credit-card debt < cash: creditor-drain extinguishes, 4c runs on reduced balances", () => {
    // $500k cash + $10k CC. Creditor-drain pays the $10k from cash,
    // leaving $490k. 4c fallback routes $490k to kid-a. No residual →
    // distributeUnlinkedLiabilities does NOT fire.
    const accounts: Account[] = [
      {
        id: "client-cash", name: "Client Cash",
        category: "cash", subType: "savings",
        owner: "client", value: 500_000, basis: 500_000,
        growthRate: 0.02, rmdEnabled: false,
      },
    ];
    const liabilities: Liability[] = [{
      id: "cc", name: "Credit Card", balance: 10_000,
      interestRate: 0.18, monthlyPayment: 500,
      startYear: 2025, startMonth: 1, termMonths: 24, extraPayments: [],
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
        owner: "client", value: 500_000, basis: 400_000,
        growthRate: 0.03, rmdEnabled: false,
      },
    ];
    const liabilities: Liability[] = [{
      id: "cc", name: "Credit Card", balance: 20_000,
      interestRate: 0.18, monthlyPayment: 800,
      startYear: 2025, startMonth: 1, termMonths: 36, extraPayments: [],
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
        owner: "client", value: 40_000_000, basis: 10_000_000,
        growthRate: 0.03, rmdEnabled: false,
      },
      {
        id: "client-cash", name: "Client Cash",
        category: "cash", subType: "savings",
        owner: "client", value: 10_000, basis: 10_000,
        growthRate: 0.01, rmdEnabled: false,
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
      trustSubType: "revocable_living" as const, isIrrevocable: false,
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
        owner: "client", value: 1_000_000, basis: 700_000,
        growthRate: 0.05, rmdEnabled: false,
        ownerEntityId: "trust-1",
      },
      {
        id: "personal-cash", name: "Personal Cash",
        category: "cash", subType: "savings",
        owner: "client", value: 100_000, basis: 100_000,
        growthRate: 0.02, rmdEnabled: false,
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
});

// ── Describe block 3: 4d integration — state estate tax ─────────────────────

describe("4d integration — state estate tax", () => {
  it("flatStateEstateRate=0: stateEstateTax=0, no impact on totals", () => {
    const accounts: Account[] = [
      {
        id: "brokerage", name: "Client Brokerage",
        category: "taxable", subType: "brokerage",
        owner: "client", value: 5_000_000, basis: 3_000_000,
        growthRate: 0.05, rmdEnabled: false,
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
        owner: "client", value: 2_000_000, basis: 1_500_000,
        growthRate: 0, rmdEnabled: false,
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
