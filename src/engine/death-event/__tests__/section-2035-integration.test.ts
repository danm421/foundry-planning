/**
 * Integration tests for the IRC §2035(a) three-year lookback wired into
 * applyFirstDeath. Verifies the end-to-end behavior:
 *   - When the deceased gifted a life-insurance policy on their own life to
 *     an irrevocable trust within 3 years of death, the face value pulls back
 *     into the gross estate via a "§2035 add-back" line.
 *   - When death is 3+ years after the gift, no add-back fires (so the
 *     ILIT-owned policy stays out of the gross estate per §2042).
 *
 * The helper itself is unit-tested in section-2035-lookback.test.ts; this
 * suite validates that first-death.ts wires the helper's addBackLines onto
 * the gross-estate result correctly.
 */

import { describe, it, expect } from "vitest";
import { applyFirstDeath } from "../index";
import type { DeathEventInput } from "../index";
import type {
  Account,
  EntitySummary,
  FamilyMember,
  GiftEvent,
  LifeInsurancePolicy,
} from "../../types";
import { LEGACY_FM_CLIENT, LEGACY_FM_SPOUSE } from "../../ownership";

const PRINCIPAL_FMS: FamilyMember[] = [
  {
    id: LEGACY_FM_CLIENT,
    role: "client",
    relationship: "other",
    firstName: "Client",
    lastName: null,
    dateOfBirth: "1965-01-01",
  },
  {
    id: LEGACY_FM_SPOUSE,
    role: "spouse",
    relationship: "other",
    firstName: "Spouse",
    lastName: null,
    dateOfBirth: "1967-01-01",
  },
];

const BASE_PLAN_SETTINGS = {
  flatFederalRate: 0,
  flatStateRate: 0,
  inflationRate: 0.025,
  planStartYear: 2026,
  planEndYear: 2080,
  estateAdminExpenses: 0,
  flatStateEstateRate: 0,
};

function mkInput(over: Partial<DeathEventInput> = {}): DeathEventInput {
  const accounts = over.accounts ?? [];
  const accountBalances: Record<string, number> = over.accountBalances ?? {};
  const basisMap: Record<string, number> = over.basisMap ?? {};
  for (const a of accounts) {
    if (accountBalances[a.id] == null) accountBalances[a.id] = a.value;
    if (basisMap[a.id] == null) basisMap[a.id] = a.basis;
  }
  return {
    year: 2050,
    deceased: "client",
    survivor: "spouse",
    will: over.will ?? null,
    accounts,
    incomes: over.incomes ?? [],
    liabilities: over.liabilities ?? [],
    familyMembers: over.familyMembers ?? PRINCIPAL_FMS,
    externalBeneficiaries: over.externalBeneficiaries ?? [],
    entities: over.entities ?? [],
    planSettings: over.planSettings ?? BASE_PLAN_SETTINGS,
    gifts: over.gifts ?? [],
    annualExclusionsByYear: over.annualExclusionsByYear ?? {},
    dsueReceived: over.dsueReceived ?? 0,
    priorTaxableGifts: over.priorTaxableGifts ?? { client: 0, spouse: 0 },
    ...over,
    accountBalances,
    basisMap,
  };
}

/** Build a term-policy life-insurance account owned by an irrevocable trust
 *  (post-gift state — the policy now sits in the ILIT, not with the grantor). */
function mkIlitPolicy(
  id: string,
  trustId: string,
  over: Partial<Account> & { policyOver?: Partial<LifeInsurancePolicy> } = {},
): Account {
  const { policyOver, ...accountOver } = over;
  return {
    id,
    name: `Term Policy ${id}`,
    category: "life_insurance",
    subType: "term",
    insuredPerson: "client",
    value: 0,
    basis: 0,
    growthRate: 0,
    rmdEnabled: false,
    owners: [{ kind: "entity", entityId: trustId, percent: 1 }],
    titlingType: "jtwros",
    lifeInsurance: {
      faceValue: 1_000_000,
      costBasis: 0,
      premiumAmount: 0,
      premiumYears: null,
      policyType: "term",
      termIssueYear: null,
      termLengthYears: null,
      endsAtInsuredRetirement: false,
      cashValueGrowthMode: "basic",
      postPayoutGrowthRate: 0,
      cashValueSchedule: [],
      ...policyOver,
    },
    ...accountOver,
  };
}

const ILIT: EntitySummary = {
  id: "ilit-1",
  name: "ILIT",
  includeInPortfolio: false,
  isGrantor: false,
  entityType: "trust",
  isIrrevocable: true,
  grantor: "client",
};

describe("§2035 integration via applyFirstDeath", () => {
  it("pulls face value into gross estate when death is within 3 years of the gift", () => {
    // Gift in 2049, death in 2050 — yearsSince = 1, inside the window.
    const giftEvent: GiftEvent = {
      kind: "asset",
      year: 2049,
      accountId: "pol-1",
      percent: 1,
      grantor: "client",
      recipientEntityId: "ilit-1",
    };
    const policy = mkIlitPolicy("pol-1", "ilit-1");

    const input = mkInput({
      year: 2050,
      deceased: "client",
      accounts: [policy],
      entities: [ILIT],
      giftEvents: [giftEvent],
    });

    const result = applyFirstDeath(input);

    // §2035 add-back line is present at face value
    const s2035Line = result.estateTax.grossEstateLines.find((l) =>
      l.label.includes("§2035 add-back"),
    );
    expect(s2035Line).toBeDefined();
    expect(s2035Line!.amount).toBe(1_000_000);
    expect(s2035Line!.accountId).toBe("pol-1");

    // Gross estate total includes the face value
    expect(result.estateTax.grossEstate).toBeGreaterThanOrEqual(1_000_000);
  });

  it("does NOT pull face value when death is 3+ years after the gift", () => {
    // Gift in 2047, death in 2050 — yearsSince = 3, outside the window.
    const giftEvent: GiftEvent = {
      kind: "asset",
      year: 2047,
      accountId: "pol-2",
      percent: 1,
      grantor: "client",
      recipientEntityId: "ilit-1",
    };
    const policy = mkIlitPolicy("pol-2", "ilit-1");

    const input = mkInput({
      year: 2050,
      deceased: "client",
      accounts: [policy],
      entities: [ILIT],
      giftEvents: [giftEvent],
    });

    const result = applyFirstDeath(input);

    // No §2035 add-back line — the gift is outside the window.
    const s2035Line = result.estateTax.grossEstateLines.find((l) =>
      l.label.includes("§2035 add-back"),
    );
    expect(s2035Line).toBeUndefined();

    // ILIT-owned policy is also NOT in gross estate via §2042 (irrevocable
    // trust owner, grantor isn't a §2042 inclusion trigger).
    const policyLine = result.estateTax.grossEstateLines.find(
      (l) => l.accountId === "pol-2",
    );
    expect(policyLine).toBeUndefined();
  });

  it("reverses the prior gift-value contribution to adjusted taxable gifts", () => {
    // Gift the policy with an advisor-supplied valuation. If the §2035
    // reversal works, that valuation does NOT consume lifetime exemption
    // (because the face value is already in the gross estate).
    const giftEvent: GiftEvent = {
      kind: "asset",
      year: 2049,
      accountId: "pol-3",
      percent: 1,
      grantor: "client",
      recipientEntityId: "ilit-1",
      amountOverride: 250_000, // advisor-supplied gift value
    };
    const policy = mkIlitPolicy("pol-3", "ilit-1");

    const input = mkInput({
      year: 2050,
      deceased: "client",
      accounts: [policy],
      entities: [ILIT],
      giftEvents: [giftEvent],
    });

    const result = applyFirstDeath(input);

    // adjustedTaxableGifts should be 0 — the §2035-pulled gift event was
    // filtered out before computeAdjustedTaxableGifts ran.
    expect(result.estateTax.adjustedTaxableGifts).toBe(0);

    // And the face value still appears in the gross estate.
    const s2035Line = result.estateTax.grossEstateLines.find((l) =>
      l.label.includes("§2035 add-back"),
    );
    expect(s2035Line).toBeDefined();
    expect(s2035Line!.amount).toBe(1_000_000);
  });
});
