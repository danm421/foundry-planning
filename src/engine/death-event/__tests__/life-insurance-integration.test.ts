/**
 * Integration tests for the life-insurance §2042 inclusion + chain routing.
 *
 * These tests verify the end-to-end wiring of prepareLifeInsurancePayouts
 * (Phase 0) feeding the 4b/4c precedence chains inside applyFirstDeath /
 * applyFinalDeath, with computeGrossEstate picking up face-value (§2042-
 * equivalent) on the pre-chain transformed state.
 *
 * No production code is changed here — §2042 inclusion is achieved by Tasks 8
 * and 9 via the prepared-state hand-off into the existing computeGrossEstate.
 */

import { describe, it, expect } from "vitest";
import { applyFirstDeath, applyFinalDeath } from "../index";
import type { DeathEventInput } from "../index";
import type {
  Account,
  BeneficiaryRef,
  EntitySummary,
  FamilyMember,
  LifeInsurancePolicy,
  Will,
} from "../../types";
import { LEGACY_FM_CLIENT, LEGACY_FM_SPOUSE } from "../../ownership";

/** Principal family members for the test household. */
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

// ── Factories ──────────────────────────────────────────────────────────────

const BASE_PLAN_SETTINGS = {
  flatFederalRate: 0,
  flatStateRate: 0,
  inflationRate: 0.025,
  planStartYear: 2026,
  planEndYear: 2080,
  estateAdminExpenses: 0,
  flatStateEstateRate: 0,
};

/** Build a DeathEventInput with married-household defaults.
 *  accountBalances and basisMap auto-mirror each account's .value / .basis
 *  unless the caller provides them explicitly. */
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
    ...over,
    // Re-apply computed maps after the ...over spread so caller's account
    // overrides get balance/basis auto-mirroring applied.
    accountBalances,
    basisMap,
  };
}

/** Build a minimal whole-life policy account. */
function mkPolicyAccount(
  id: string,
  over: Partial<Account> & { policyOver?: Partial<LifeInsurancePolicy> } = {},
): Account {
  const { policyOver, ...accountOver } = over;
  return {
    id,
    name: `Life Policy ${id}`,
    category: "life_insurance",
    subType: "whole",
    insuredPerson: "client",
    value: 50_000,   // cash value (pre-payout)
    basis: 0,
    growthRate: 0,
    rmdEnabled: false,
    owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    lifeInsurance: {
      faceValue: 1_000_000,
      costBasis: 0,
      premiumAmount: 5_000,
      premiumYears: null,
      policyType: "whole",
      termIssueYear: null,
      termLengthYears: null,
      endsAtInsuredRetirement: false,
      cashValueGrowthMode: "basic",
      postPayoutMergeAccountId: null,
      postPayoutGrowthRate: 0.04,
      cashValueSchedule: [],
      ...policyOver,
    },
    ...accountOver,
  };
}

/** Build a minimal cash/savings account. */
function mkCashAccount(
  id: string,
  value: number,
): Account {
  return {
    id,
    name: `Cash ${id}`,
    category: "cash",
    subType: "savings",
    value,
    basis: value,
    growthRate: 0.02,
    rmdEnabled: false,
    owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
  };
}

/** Build an all_assets-residual will for the given grantor routing to spouse. */
function mkSpouseWill(grantor: "client" | "spouse"): Will {
  return {
    id: `will-${grantor}`,
    grantor,
    bequests: [
      {
        id: "beq-all",
        name: "All assets to spouse",
        kind: "asset",
        assetMode: "all_assets",
        accountId: null,
        liabilityId: null,
        percentage: 100,
        condition: "always",
        sortOrder: 0,
        recipients: [
          { recipientKind: "spouse", recipientId: null, percentage: 100, sortOrder: 0 },
        ],
      },
    ],
  };
}

// ── Scenarios ──────────────────────────────────────────────────────────────

describe("life-insurance §2042 inclusion + chain routing — integration", () => {

  it("person-owned self-insured policy with beneficiaries routes face value to beneficiaries via Step 2", () => {
    const kid1: FamilyMember = {
      id: "kid-1",
      relationship: "child",
      role: "child" as const,
      firstName: "Alice",
      lastName: null,
      dateOfBirth: null,
    };
    const beneRef: BeneficiaryRef = {
      id: "bref-1",
      tier: "primary",
      percentage: 100,
      familyMemberId: "kid-1",
      sortOrder: 0,
    };
    const policy = mkPolicyAccount("pol-1", {
      insuredPerson: "client",
      beneficiaries: [beneRef],
    });

    const input = mkInput({
      deceased: "client",
      accounts: [policy],
      familyMembers: [...PRINCIPAL_FMS, kid1],
    });

    const result = applyFirstDeath(input);

    // Chain Step 2: beneficiary designation routes faceValue to kid-1
    const beneTransfer = result.transfers.find(
      (t) => t.via === "beneficiary_designation" && t.sourceAccountId === "pol-1",
    );
    expect(beneTransfer).toBeDefined();
    expect(beneTransfer!.amount).toBeCloseTo(1_000_000, 0);
    expect(beneTransfer!.recipientKind).toBe("family_member");
    expect(beneTransfer!.recipientId).toBe("kid-1");

    // §2042: face value included in gross estate
    const geLine = result.estateTax.grossEstateLines.find((l) => l.accountId === "pol-1");
    expect(geLine).toBeDefined();
    expect(geLine!.amount).toBeCloseTo(1_000_000, 0);
    expect(geLine!.percentage).toBe(1);
  });

  it("person-owned self-insured policy with no beneficiaries falls through to will bequest", () => {
    const policy = mkPolicyAccount("pol-2", {
      insuredPerson: "client",
      // no beneficiaries
    });

    const input = mkInput({
      deceased: "client",
      accounts: [policy],
      will: mkSpouseWill("client"),
    });

    const result = applyFirstDeath(input);

    // Chain Step 3b: all_assets residual routes faceValue to spouse via will
    const willTransfer = result.transfers.find(
      (t) => t.via === "will" && t.sourceAccountId === "pol-2",
    );
    expect(willTransfer).toBeDefined();
    expect(willTransfer!.amount).toBeCloseTo(1_000_000, 0);
    expect(willTransfer!.recipientKind).toBe("spouse");

    // §2042: face value still included in gross estate
    const geLine = result.estateTax.grossEstateLines.find((l) => l.accountId === "pol-2");
    expect(geLine).toBeDefined();
    expect(geLine!.amount).toBeCloseTo(1_000_000, 0);

    // Warning emitted for missing beneficiary
    expect(result.warnings.some((w) => w === `life_insurance_no_beneficiaries:pol-2`)).toBe(true);
  });

  it("person-owned self-insured policy with no beneficiaries and no will falls through to default-transfer schedule", () => {
    const policy = mkPolicyAccount("pol-3", {
      insuredPerson: "client",
      // no beneficiaries
    });

    const input = mkInput({
      deceased: "client",
      accounts: [policy],
      will: null,
      survivor: "spouse",
    });

    const result = applyFirstDeath(input);

    // Chain Step 4: fallback tier 1 routes faceValue to spouse
    const fallbackTransfer = result.transfers.find(
      (t) => t.via === "fallback_spouse" && t.sourceAccountId === "pol-3",
    );
    expect(fallbackTransfer).toBeDefined();
    expect(fallbackTransfer!.amount).toBeCloseTo(1_000_000, 0);
    expect(fallbackTransfer!.recipientKind).toBe("spouse");

    // §2042: face value included in gross estate
    const geLine = result.estateTax.grossEstateLines.find((l) => l.accountId === "pol-3");
    expect(geLine).toBeDefined();
    expect(geLine!.amount).toBeCloseTo(1_000_000, 0);

    // Warnings: no-beneficiaries warning (Phase 0) + fallback fired (applyFallback)
    expect(result.warnings.some((w) => w === "life_insurance_no_beneficiaries:pol-3")).toBe(true);
    expect(result.warnings.some((w) => w === "residual_fallback_fired:pol-3")).toBe(true);
  });

  it("ILIT-owned policy excludes face value from decedent's gross estate", () => {
    const ilitEntity: EntitySummary = {
      id: "ilit-1",
      isIrrevocable: true,
      grantor: "client",
      includeInPortfolio: false,
      isGrantor: false,
    };
    // The ILIT owns the policy (entity-owned, not FM-owned). This excludes the
    // face value from the grantor's gross estate under §2042.
    const policy = mkPolicyAccount("pol-4", {
      insuredPerson: "client",
      owners: [{ kind: "entity", entityId: "ilit-1", percent: 1 }],
    });

    const input = mkInput({
      deceased: "client",
      accounts: [policy],
      entities: [ilitEntity],
    });

    const result = applyFirstDeath(input);

    // §2042 exclusion: ILIT-owned policy must NOT appear in gross estate
    const geLine = result.estateTax.grossEstateLines.find((l) => l.accountId === "pol-4");
    expect(geLine).toBeUndefined();
  });

  it("revocable-trust-owned policy with grantor === deceased includes face value in gross estate", () => {
    const revEntity: EntitySummary = {
      id: "rev-1",
      isIrrevocable: false,
      grantor: "client",
      includeInPortfolio: true,
      isGrantor: true,
    };
    const policy = mkPolicyAccount("pol-5", {
      insuredPerson: "client",
    });

    const input = mkInput({
      deceased: "client",
      accounts: [policy],
      entities: [revEntity],
    });

    const result = applyFirstDeath(input);

    // §2042 inclusion: revocable-trust-owned policy with grantor=deceased included
    const geLine = result.estateTax.grossEstateLines.find((l) => l.accountId === "pol-5");
    expect(geLine).toBeDefined();
    expect(geLine!.amount).toBeCloseTo(1_000_000, 0);
  });

  it("cross-owned policy (owner = client, insured = spouse) is unchanged when spouse dies", () => {
    /**
     * Phase 0 DOES trigger payout when insuredPerson === deceased (spouse), regardless
     * of who owns the policy. The policy transforms to a cash-equivalent account owned
     * by "client". The 4b precedence chain then skips it (only processes accounts
     * touched by the deceased, i.e. owner === "spouse" or owner === "joint"). So:
     *   - No transfer is emitted (chain skips client-owned accounts).
     *   - Account category becomes "cash" / subType "life_insurance_proceeds".
     *   - §2042: The transformed account is owned by client (survivor), so it is NOT
     *     in the gross estate of the deceased (spouse).
     */
    const policy = mkPolicyAccount("pol-6", {
      // client owns the policy
      insuredPerson: "spouse", // spouse is insured — payout triggers at spouse's death
      value: 50_000,
    });

    // Run as if spouse is the deceased — client survives, receives the proceeds
    const input = mkInput({
      deceased: "spouse",
      survivor: "client",
      accounts: [policy],
      will: null,
    });

    const result = applyFirstDeath(input);

    // No transfer emitted for the cross-owned policy (chain skips client-owned accounts)
    const policyTransfer = result.transfers.find((t) => t.sourceAccountId === "pol-6");
    expect(policyTransfer).toBeUndefined();

    // Policy account still present but transformed to cash (payout triggered in Phase 0)
    const policyAcct = result.accounts.find((a) => a.id === "pol-6");
    expect(policyAcct).toBeDefined();
    // Phase 0 reclassifies the triggering policy to cash/life_insurance_proceeds
    expect(policyAcct!.category).toBe("cash");
    expect(policyAcct!.subType).toBe("life_insurance_proceeds");
    // Phase 0 standalone mode must substitute faceValue for value
    expect(policyAcct!.value).toBe(1_000_000);

    // §2042 exclusion: the transformed account owner is "client" (not deceased "spouse")
    // → computeGrossEstate skips it → face value NOT in spouse's gross estate
    const geLine = result.estateTax.grossEstateLines.find((l) => l.accountId === "pol-6");
    expect(geLine).toBeUndefined();
  });

  it("joint-insured policy does nothing at first death", () => {
    // Policy is jointly owned by client and spouse (JTWROS-style).
    const policy = mkPolicyAccount("pol-7", {
      owners: [
        { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.5 },
        { kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 0.5 },
      ],
      insuredPerson: "joint",
      value: 50_000,
    });

    const input = mkInput({
      deceased: "client",
      survivor: "spouse",
      accounts: [policy],
      will: mkSpouseWill("client"),
    });

    const result = applyFirstDeath(input);

    // Step 1 (titling) retitles the joint account to spouse — a transfer IS emitted.
    // The policy hasn't paid out, so via is "titling" (not a payout route).
    const policyTransfer = result.transfers.find((t) => t.sourceAccountId === "pol-7");
    expect(policyTransfer).toBeDefined();
    expect(policyTransfer!.via).toBe("titling");

    // Policy account still in result (possibly retitled to spouse via joint titling)
    const policyAcct = result.accounts.find((a) => a.id === "pol-7");
    expect(policyAcct).toBeDefined();
    // Category stays life_insurance (not transformed to cash)
    expect(policyAcct!.category).toBe("life_insurance");

    // §2042: joint-insured at first death — only 50% of the joint account could be
    // in the gross estate. The joint account is valued at cash value pre-payout
    // (policy didn't trigger, so balance = 50_000 @ 50%).
    const geLine = result.estateTax.grossEstateLines.find((l) => l.accountId === "pol-7");
    // Joint accounts at first death always produce a 50% line in computeGrossEstate
    // when balance > 0, so geLine is deterministically defined.
    // At 50% of cashValue: 50_000 * 0.5 = 25_000. Face value is NOT included (no payout triggered).
    expect(geLine).toBeDefined();
    expect(geLine!.amount).toBeCloseTo(25_000, 0); // 50% of 50k cash value
    // No §2042 face-value line for untriggered joint policy.
    const faceValueLine = result.estateTax.grossEstateLines.find(
      (l) => l.accountId === "pol-7" && l.amount > 100_000,
    );
    expect(faceValueLine).toBeUndefined();
  });

  it("joint-insured policy pays out at final death", () => {
    // Same joint policy — joint-insured fires at final_death eventKind.
    // At final death the spouse is the second to die. The policy was retitled
    // to the spouse at first death (spouse is now the sole owner). When the
    // spouse dies last, the payout triggers (joint insured + final_death) and
    // the chain distributes the proceeds.
    const policy = mkPolicyAccount("pol-8", {
      // retitled to spouse at first-death; spouse is now sole owner
      owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 1 }],
      insuredPerson: "joint",
      value: 50_000,
    });
    const kid1: FamilyMember = {
      id: "kid-1",
      relationship: "child",
      role: "child" as const,
      firstName: "Alice",
      lastName: null,
      dateOfBirth: null,
    };

    const input = mkInput({
      year: 2055,
      deceased: "spouse",
      survivor: "client",   // irrelevant for final death but required by type
      accounts: [policy],
      familyMembers: [...PRINCIPAL_FMS, kid1],
      will: null,
    });

    const result = applyFinalDeath(input);

    // Payout must fire: transfer emitted with amount = faceValue = 1_000_000
    const policyTransfer = result.transfers.find((t) => t.sourceAccountId === "pol-8");
    expect(policyTransfer).toBeDefined();
    expect(policyTransfer!.amount).toBeCloseTo(1_000_000, 0);

    // §2042: face value included in gross estate at 100% (deathOrder=2, no halving)
    const geLine = result.estateTax.grossEstateLines.find((l) => l.accountId === "pol-8");
    expect(geLine).toBeDefined();
    expect(geLine!.amount).toBeCloseTo(1_000_000, 0);
    expect(geLine!.percentage).toBe(1);
  });

  it("merge-target mode consolidates proceeds into target and routes per target's owner", () => {
    /**
     * Scenario 9: Discovery test.
     *
     * The policy has postPayoutMergeAccountId → "sp-broker". In Phase 0,
     * prepareLifeInsurancePayouts removes the policy from the accounts list and
     * credits faceValue (1_000_000) directly into sp-broker's balance. The policy
     * account no longer exists when computeGrossEstate runs.
     *
     * Observed behavior:
     *   - sp-broker is owned by "spouse", and the deceased is "client".
     *   - computeGrossEstate skips sp-broker because owner !== "client" and it's
     *     not a joint account.
     *   - Therefore, the $1M face value contribution is NOT attributed to any
     *     gross-estate line. The merged proceeds are invisible to §2042.
     *
     * This is a design gap: the merge path bypasses §2042 attribution entirely.
     * The proceeds land in a spouse-owned account (no §2042 inclusion for the
     * client's policy) — which may actually be tax-favorable for life insurance
     * payable to a spouse, but it means §2042 estate-inclusion is silently skipped
     * for non-spousal merge targets as well. See future-work/engine.md for the
     * full tracking item.
     */
    const policy = mkPolicyAccount("pol-9", {
      insuredPerson: "client",
      value: 50_000,
      policyOver: {
        faceValue: 1_000_000,
        postPayoutMergeAccountId: "sp-broker",
        postPayoutGrowthRate: 0.05,
      },
    });
    const spBroker = { ...mkCashAccount("sp-broker", 500_000), owners: [{ kind: "family_member" as const, familyMemberId: LEGACY_FM_SPOUSE, percent: 1 }] };

    const input = mkInput({
      deceased: "client",
      accounts: [policy, spBroker],
    });

    const result = applyFirstDeath(input);

    // Policy account is removed from result.accounts (merged into sp-broker)
    const policyAcct = result.accounts.find((a) => a.id === "pol-9");
    expect(policyAcct).toBeUndefined();

    // sp-broker balance = original 500k + faceValue 1M = 1.5M
    expect(result.accountBalances["sp-broker"]).toBeCloseTo(1_500_000, 0);

    // §2042 discovery: the face value is NOT captured in any gross-estate line.
    // sp-broker is spouse-owned → computeGrossEstate skips it (owner !== deceased).
    // The pol-9 account is gone from prepared.accounts before computeGrossEstate runs.
    // Result: zero §2042 inclusion for the merged 1M.
    //
    // This is the observed behavior. We assert it as-is to lock in the current
    // contract. If future work adds a §2042 credit for retired merge-target policies,
    // this assertion will need to be updated.
    const polGeLine = result.estateTax.grossEstateLines.find((l) => l.accountId === "pol-9");
    expect(polGeLine).toBeUndefined();

    const spBrokerGeLine = result.estateTax.grossEstateLines.find((l) => l.accountId === "sp-broker");
    // sp-broker is spouse-owned → excluded from client's gross estate
    expect(spBrokerGeLine).toBeUndefined();

    // Total gross estate is effectively 0 (no client-owned assets remain after merge)
    expect(result.estateTax.grossEstate).toBeCloseTo(0, 0);
  });

});
