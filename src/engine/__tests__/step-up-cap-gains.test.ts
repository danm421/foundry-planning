import { describe, it, expect } from "vitest";
import { applyFirstDeath } from "../death-event";
import type { DeathEventInput } from "../death-event";
import { applyAssetSales } from "../asset-transactions";
import type {
  Account, AssetTransaction, FamilyMember, Will, PlanSettings,
  AccountLedger,
} from "../types";
import { LEGACY_FM_CLIENT, LEGACY_FM_SPOUSE } from "../ownership";

describe("step-up end-to-end: death + future sale → correct cap-gains", () => {
  const jointBrok: Account = {
    id: "joint-brok", name: "Joint Brokerage",
    category: "taxable", subType: "brokerage",
    value: 500_000, basis: 200_000,
    growthRate: 0.05, rmdEnabled: false,
    owners: [
      { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.5 },
      { kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 0.5 },
    ],
  };
  const cashForProceeds: Account = {
    id: "cash", name: "Joint Checking",
    category: "cash", subType: "checking",
    value: 10_000, basis: 10_000,
    growthRate: 0, rmdEnabled: false,
    owners: [
      { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.5 },
      { kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 0.5 },
    ],
  };
  const will: Will = {
    id: "w", grantor: "client",
    bequests: [{
      id: "b1", name: "All to spouse",
      kind: "asset", assetMode: "all_assets",
      accountId: null, liabilityId: null,
      percentage: 100, condition: "always", sortOrder: 0,
      recipients: [{ recipientKind: "spouse", recipientId: null, percentage: 100, sortOrder: 0 }],
    }],
  };
  const fams: FamilyMember[] = [];
  const planSettings: PlanSettings = {
    flatFederalRate: 0,
    flatStateRate: 0,
    inflationRate: 0.025,
    planStartYear: 2026,
    planEndYear: 2080,
    estateAdminExpenses: 0,
    flatStateEstateRate: 0,
  };

  it("joint brokerage $500k/$200k → half step-up at first death → cap-gain computed against stepped-up basis at sale 5yr later", () => {
    // Step 1: first death in 2050 with joint brokerage at FMV $500k, basis $200k.
    const deathInput: DeathEventInput = {
      year: 2050,
      deceased: "client",
      survivor: "spouse",
      will,
      accounts: [jointBrok, cashForProceeds],
      accountBalances: { "joint-brok": 500_000, "cash": 10_000 },
      basisMap: { "joint-brok": 200_000, "cash": 10_000 },
      incomes: [],
      liabilities: [],
      familyMembers: fams,
      externalBeneficiaries: [],
      entities: [],
      planSettings,
      gifts: [],
      annualExclusionsByYear: {},
      dsueReceived: 0,
      priorTaxableGifts: { client: 0, spouse: 0 },
    };
    const deathResult = applyFirstDeath(deathInput);

    // Assert: survivor's basisMap entry for joint-brok = (500k + 200k) / 2 = 350k
    expect(deathResult.basisMap["joint-brok"]).toBeCloseTo(350_000, 2);

    // Step 2: 5 years of growth at 5%/yr on the surviving account.
    const growthFactor = Math.pow(1.05, 5);
    const yearN5Balance = 500_000 * growthFactor;
    const postGrowthBalances: Record<string, number> = {
      "joint-brok": yearN5Balance,
      "cash": 10_000,
    };
    // basisMap stays at the stepped-up value — growth doesn't touch basis.
    const postGrowthBasis = { ...deathResult.basisMap };

    // Step 3: survivor sells the whole joint-brok account in year 2055.
    const sale: AssetTransaction = {
      id: "sale-1", name: "Sell inherited brokerage",
      type: "sell", year: 2055,
      accountId: "joint-brok",
      proceedsAccountId: "cash",
      transactionCostPct: 0,
      transactionCostFlat: 0,
    };
    const ledgers: Record<string, AccountLedger> = {};
    const salesResult = applyAssetSales({
      sales: [sale],
      accounts: deathResult.accounts,
      liabilities: [],
      accountBalances: postGrowthBalances,
      basisMap: postGrowthBasis,
      accountLedgers: ledgers,
      year: 2055,
      defaultCheckingId: "cash",
      filingStatus: "married_joint",
    });

    // Expected cap-gain WITH step-up: yearN5Balance - 350k
    const expectedGainWithStepUp = yearN5Balance - 350_000;
    expect(salesResult.capitalGains).toBeCloseTo(expectedGainWithStepUp, 2);

    // Sanity check: if step-up hadn't happened, gain would have been
    // yearN5Balance - 200k (exactly $150k more because the dead half's
    // $150k of latent gain would not have been erased).
    const hypotheticalNoStepUpGain = yearN5Balance - 200_000;
    expect(hypotheticalNoStepUpGain - expectedGainWithStepUp).toBeCloseTo(150_000, 2);
  });
});
