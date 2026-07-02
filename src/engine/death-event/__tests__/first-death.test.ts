import { describe, expect, it } from "vitest";
import { applyFirstDeath } from "../first-death";
import type { DeathEventInput } from "../shared";
import type {
  Account,
  FamilyMember,
  Income,
  PlanSettings,
  Will,
} from "../../types";
import { LEGACY_FM_CLIENT, LEGACY_FM_SPOUSE } from "../../ownership";

const clientFm: FamilyMember = {
  id: LEGACY_FM_CLIENT,
  role: "client",
  relationship: "other",
  firstName: "Client",
  lastName: "Test",
  dateOfBirth: "1970-01-01",
};
const spouseFm: FamilyMember = {
  id: LEGACY_FM_SPOUSE,
  role: "spouse",
  relationship: "other",
  firstName: "Spouse",
  lastName: "Test",
  dateOfBirth: "1972-01-01",
};

const kidA: FamilyMember = {
  id: "kid-a",
  role: "child",
  relationship: "child",
  firstName: "Alice",
  lastName: "Test",
  dateOfBirth: "2000-01-01",
};
const kidB: FamilyMember = {
  id: "kid-b",
  role: "child",
  relationship: "child",
  firstName: "Bob",
  lastName: "Test",
  dateOfBirth: "2002-01-01",
};

const planSettings = (over: Partial<PlanSettings> = {}): PlanSettings => ({
  flatFederalRate: 0,
  flatStateRate: 0,
  inflationRate: 0.025,
  planStartYear: 2026,
  planEndYear: 2080,
  taxInflationRate: 0.025,
  estateAdminExpenses: 0,
  flatStateEstateRate: 0,
  ...over,
});

const mkInput = (over: Partial<DeathEventInput>): DeathEventInput => {
  const accounts = over.accounts ?? [];
  const accountBalances: Record<string, number> = { ...(over.accountBalances ?? {}) };
  const basisMap: Record<string, number> = { ...(over.basisMap ?? {}) };
  for (const a of accounts) {
    if (accountBalances[a.id] == null) accountBalances[a.id] = a.value;
    if (basisMap[a.id] == null) basisMap[a.id] = a.basis;
  }
  const callerFms = over.familyMembers ?? [];
  const principals = [clientFm, spouseFm].filter(
    (p) => !callerFms.some((f) => f.id === p.id),
  );
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
    familyMembers: [...principals, ...callerFms],
    externalBeneficiaries: [],
    entities: [],
    planSettings: planSettings(),
    gifts: [],
    annualExclusionsByYear: {},
    dsueReceived: 0,
    priorTaxableGifts: { client: 0, spouse: 0 },
    ...rest,
  };
};

describe("applyFirstDeath — gross transfers + drain attribution (Phase B)", () => {
  it("emits gross asset transfers (chain runs pre-drain)", () => {
    // $1M to spouse via fallback. Spouse fully shields via marital deduction
    // → $0 estate tax. Transfer.amount === $1M.
    const brokerage: Account = {
      id: "brok",
      name: "Brokerage",
      category: "taxable",
      subType: "brokerage",
      value: 1_000_000,
      basis: 500_000,
      growthRate: 0,
      rmdEnabled: false,
      titlingType: "jtwros",
      owners: [
        { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 },
      ],
    };
    const input = mkInput({
      accounts: [brokerage],
      planSettings: planSettings({ flatStateEstateRate: 0.1 }),
    });
    const result = applyFirstDeath(input);

    expect(result.estateTax.maritalDeduction).toBeCloseTo(1_000_000, 0);
    expect(result.estateTax.federalEstateTax).toBeCloseTo(0, 0);
    expect(result.estateTax.stateEstateTax).toBeCloseTo(0, 0);

    const assetTransfers = result.transfers.filter(
      (t) => t.sourceAccountId != null && t.amount > 0,
    );
    expect(assetTransfers).toHaveLength(1);
    expect(assetTransfers[0].recipientKind).toBe("spouse");
    expect(assetTransfers[0].amount).toBeCloseTo(1_000_000, 0);
  });

  it("drainAttributions reconcile and exempt spouse from estate tax", () => {
    // Will routes 50% to spouse (marital), 50% to kid-a.
    // 10% state tax on the taxable half. drainAttribution for state tax
    // should land entirely on kid-a, not on spouse.
    const brokerage: Account = {
      id: "brok",
      name: "Brokerage",
      category: "taxable",
      subType: "brokerage",
      value: 2_000_000,
      basis: 1_000_000,
      growthRate: 0,
      rmdEnabled: false,
      titlingType: "jtwros",
      owners: [
        { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 },
      ],
    };
    const will: Will = {
      id: "w1",
      grantor: "client",
      bequests: [
        {
          id: "b1",
          name: "Half to spouse",
          kind: "asset",
          assetMode: "all_assets",
          accountId: null,
          liabilityId: null, entityId: null,
          percentage: 50,
          condition: "always",
          sortOrder: 0,
          recipients: [
            {
              recipientKind: "spouse",
              recipientId: null,
              percentage: 100,
              sortOrder: 0,
            },
          ],
        },
        {
          id: "b2",
          name: "Half to kid-a",
          kind: "asset",
          assetMode: "all_assets",
          accountId: null,
          liabilityId: null, entityId: null,
          percentage: 50,
          condition: "always",
          sortOrder: 1,
          recipients: [
            {
              recipientKind: "family_member",
              recipientId: "kid-a",
              percentage: 100,
              sortOrder: 0,
            },
          ],
        },
      ],
    };
    const input = mkInput({
      accounts: [brokerage],
      will,
      familyMembers: [kidA, kidB],
      planSettings: planSettings({ flatStateEstateRate: 0.1 }),
    });
    const result = applyFirstDeath(input);

    expect(result.estateTax.stateEstateTax).toBeGreaterThan(0);

    const stateAttribs = result.estateTax.drainAttributions.filter(
      (a) => a.drainKind === "state_estate_tax",
    );
    const onSpouse = stateAttribs.find((a) => a.recipientKind === "spouse");
    const onKidA = stateAttribs.find((a) => a.recipientId === "kid-a");
    expect(onSpouse).toBeUndefined();
    expect(onKidA?.amount).toBeCloseTo(result.estateTax.stateEstateTax, 0);
  });
});

describe("applyFirstDeath — business-interest succession integration", () => {
  it("routes a wholly client-owned LLC account to spouse via fallback, applies marital deduction", () => {
    // $10k flat value, $4k basis, client owns 100%. Spouse survives, no will.
    // Under the account-based business model the LLC is a top-level business
    // account; the transfer's sourceAccountId is the business account's id.
    const llcAccount: Account = {
      id: "biz-1",
      name: "Client LLC",
      category: "business",
      subType: "llc",
      value: 10_000,
      basis: 4_000,
      businessType: "llc",
      parentAccountId: null,
      growthRate: 0,
      rmdEnabled: false,
      titlingType: "jtwros",
      owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    };

    const input = mkInput({
      accounts: [llcAccount],
      accountBalances: { "biz-1": 10_000 },
    });
    const result = applyFirstDeath(input);

    // Exactly ONE transfer for the business account — the consolidated one
    // emitted by applyBusinessSuccession. The precedence chain skips
    // top-level business accounts (business-succession is canonical) so it
    // does NOT produce a parallel routing transfer.
    const bizTransfers = result.transfers.filter(
      (t) => t.sourceAccountId === "biz-1",
    );
    expect(bizTransfers).toHaveLength(1);
    const bizSuccessionTransfer = bizTransfers[0];
    expect(bizSuccessionTransfer.via).toBe("fallback_spouse");
    expect(bizSuccessionTransfer.recipientKind).toBe("spouse");
    expect(bizSuccessionTransfer.amount).toBeCloseTo(10_000, 0);

    // Marital deduction covers the $10k business value — no estate tax.
    expect(result.estateTax.maritalDeduction).toBeGreaterThanOrEqual(10_000 - 1);
    expect(result.estateTax.federalEstateTax).toBeCloseTo(0, 0);
  });

  it("emits a single consolidated transfer (not flat + chain) when the business has a child account", () => {
    // Reproduces the Cooper Sample bug: top-level business (Test Bus, $1M
    // own value) with a real-estate child (Rental, $50k). Pre-fix the
    // chain emitted a separate $50k flat transfer AND business-succession
    // emitted a $1.05M consolidated transfer — double-count. Post-fix the
    // chain skips top-level business accounts; only the $1.05M consolidated
    // transfer remains.
    const testBus: Account = {
      id: "test-bus",
      name: "Test Bus",
      category: "business",
      subType: "llc",
      value: 1_000_000,
      basis: 400_000,
      businessType: "llc",
      parentAccountId: null,
      growthRate: 0,
      rmdEnabled: false,
      titlingType: "jtwros",
      owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    };
    const rental: Account = {
      id: "rental",
      name: "Rental",
      category: "real_estate",
      subType: "rental",
      value: 50_000,
      basis: 50_000,
      growthRate: 0,
      rmdEnabled: false,
      titlingType: "jtwros",
      parentAccountId: "test-bus",
      owners: [{ kind: "entity", entityId: "test-bus-entity", percent: 1 }],
    };
    const input = mkInput({
      accounts: [testBus, rental],
      accountBalances: { "test-bus": 1_000_000, "rental": 50_000 },
    });
    const result = applyFirstDeath(input);

    const bizTransfers = result.transfers.filter(
      (t) => t.sourceAccountId === "test-bus" && t.amount > 0,
    );
    expect(bizTransfers).toHaveLength(1);
    expect(bizTransfers[0].via).toBe("fallback_spouse");
    expect(bizTransfers[0].amount).toBeCloseTo(1_050_000, 0);

    // No standalone transfer for the parented child either.
    const rentalTransfers = result.transfers.filter(
      (t) => t.sourceAccountId === "rental" && t.amount > 0,
    );
    expect(rentalTransfers).toHaveLength(0);
  });
});

describe("applyFirstDeath — community-property step-up integration", () => {
  // Joint 50/50 client+spouse taxable account, $1M FMV, $400k basis.
  // At first death the titling step routes 100% to the surviving spouse.
  // §1014(b)(6) → community_property gets a full step-up (basis = FMV = $1M);
  // jtwros gets the half step-up ((FMV + basis)/2 = $700k).
  const buildJointBrokerage = (
    titlingType: "community_property" | "jtwros",
  ): Account => ({
    id: "acct-joint",
    name: "Joint Brokerage",
    category: "taxable",
    subType: "brokerage",
    value: 1_000_000,
    basis: 400_000,
    growthRate: 0,
    rmdEnabled: false,
    titlingType,
    owners: [
      { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.5 },
      { kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 0.5 },
    ],
  });

  it("community_property joint taxable account gets full step-up at first death", () => {
    const input = mkInput({
      accounts: [buildJointBrokerage("community_property")],
    });
    const result = applyFirstDeath(input);

    const titling = result.transfers.find(
      (t) => t.sourceAccountId === "acct-joint" && t.via === "titling",
    );
    expect(titling).toBeDefined();
    expect(titling!.recipientKind).toBe("spouse");

    const resultingAcct = result.accounts.find(
      (a) => a.id === titling!.resultingAccountId,
    );
    expect(resultingAcct).toBeDefined();
    expect(resultingAcct!.value).toBe(1_000_000);
    // §1014(b)(6) full step-up: both halves reset to FMV.
    expect(resultingAcct!.basis).toBe(1_000_000);
  });

  it("jtwros joint taxable account gets half step-up at first death (regression)", () => {
    const input = mkInput({
      accounts: [buildJointBrokerage("jtwros")],
    });
    const result = applyFirstDeath(input);

    const titling = result.transfers.find(
      (t) => t.sourceAccountId === "acct-joint" && t.via === "titling",
    );
    expect(titling).toBeDefined();
    expect(titling!.recipientKind).toBe("spouse");

    const resultingAcct = result.accounts.find(
      (a) => a.id === titling!.resultingAccountId,
    );
    expect(resultingAcct).toBeDefined();
    expect(resultingAcct!.value).toBe(1_000_000);
    // §1014 half step-up: (FMV + basis) / 2 = (1_000_000 + 400_000) / 2 = 700_000.
    expect(resultingAcct!.basis).toBe(700_000);
  });
});

describe("applyFirstDeath — probate cost integration", () => {
  // Solely-owned, no-beneficiary brokerage → passes through probate at first
  // death. The probate cost is deducted from the estate and added to
  // totalTaxesAndExpenses, independent of the marital deduction.
  const soleBrokerage: Account = {
    id: "brok",
    name: "Brokerage",
    category: "taxable",
    subType: "brokerage",
    value: 1_000_000,
    basis: 500_000,
    growthRate: 0,
    rmdEnabled: false,
    titlingType: "jtwros",
    owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
  };

  it("folds the probate cost into the estate's taxes & expenses", () => {
    const baseline = applyFirstDeath(
      mkInput({ accounts: [soleBrokerage], planSettings: planSettings() }),
    ).estateTax;
    const withProbate = applyFirstDeath(
      mkInput({
        accounts: [soleBrokerage],
        planSettings: planSettings({ probateCostRate: 0.05 }),
      }),
    ).estateTax;

    expect(baseline.probateCost).toBe(0);
    expect(withProbate.probateEstate).toBeCloseTo(1_000_000, 0);
    expect(withProbate.probateCost).toBeCloseTo(50_000, 0);
    expect(withProbate.totalTaxesAndExpenses - baseline.totalTaxesAndExpenses)
      .toBeCloseTo(50_000, 0);
  });
});

describe("applyFirstDeath — §2039 survivor-annuity gross-estate inclusion", () => {
  const decedentPension: Income = {
    id: "pen1",
    type: "deferred",
    name: "VA Benefit",
    annualAmount: 51_576,
    startYear: 2030,
    endYear: 2070,
    growthRate: 0.024,
    owner: "client",
    survivorshipPct: 0.5,
  };

  it("adds a survivor-annuity PV line to the decedent's gross estate", () => {
    const baseline = applyFirstDeath(
      mkInput({ incomes: [decedentPension] }),
    ).estateTax;

    const withInclusion = applyFirstDeath(
      mkInput({
        incomes: [decedentPension],
        survivorBirthYear: 1972,
        survivorLifeExpectancy: 90,
      }),
    ).estateTax;

    const line = withInclusion.grossEstateLines.find((l) =>
      /^Survivor annuity — /.test(l.label),
    );
    expect(line).toBeDefined();
    expect(line?.amount).toBeGreaterThan(0);
    expect(line?.accountId).toBeNull();
    expect(line?.liabilityId).toBeNull();

    // Gross estate rises by exactly the survivor-annuity PV line.
    expect(withInclusion.grossEstate - baseline.grossEstate).toBeCloseTo(
      line!.amount,
      0,
    );
    expect(
      baseline.grossEstateLines.some((l) => /^Survivor annuity — /.test(l.label)),
    ).toBe(false);
  });
});
