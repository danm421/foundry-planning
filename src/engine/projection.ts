import type {
  ClientData,
  ProjectionYear,
  AccountLedger,
  AccountLedgerEntry,
  Liability,
  EntitySummary,
  Account,
  WithdrawalPriority,
  PlanSettings,
  DeductionBreakdown,
  Income,
  Expense,
  EstateTaxResult,
  HypotheticalEstateTax,
} from "./types";
import { computeEntityCashFlow, type EntityMetadata } from "./entity-cashflow";
import { accrueLockedEntityShare } from "./locked-shares";
import { computeFamilyAccountShares } from "./family-cashflow";
import { computeGiftLedger, type GiftLedgerYear } from "./gift-ledger";
import { computeIncome } from "./income";
import { computeExpenses } from "./expenses";
import { computeLiabilities } from "./liabilities";
import {
  buildLiabilitySchedule,
  buildLiabilitySchedules,
  scheduleBoYBalance,
  type LiabilityScheduleMap,
} from "./liability-schedules";
import { createTaxResolver } from "../lib/tax/resolver";
import type { TaxYearParameters, FilingStatus } from "../lib/tax/types";
import {
  deriveAboveLineFromSavings,
  deriveAboveLineFromExpenses,
  deriveItemizedFromExpenses,
  deriveMortgageInterestFromLiabilities,
  derivePropertyTaxFromAccounts,
  sumItemizedFromEntries,
  aggregateDeductions,
  saltCap,
} from "../lib/tax/derive-deductions";
import { applySavingsRules, computeEmployerMatch, resolveContributionAmount } from "./savings";
import { itemProrationGate } from "./retirement-proration";
import { applyContributionLimits, computeMaxContribution, resolveAgeInYear } from "./contribution-limits";
import { executeWithdrawals, planSupplementalWithdrawal } from "./withdrawal";
import { calculateRMD } from "./rmd";
import { applyTransfers } from "./transfers";
import { applyRothConversions } from "./roth-conversions";
import { applyAssetSales, applyAssetPurchases, _resetSyntheticIdCounter } from "./asset-transactions";
import {
  computeFirstDeathYear,
  computeFinalDeathYear,
  identifyDeceased,
  identifyFinalDeceased,
  effectiveFilingStatus,
  applyFirstDeath,
  applyFinalDeath,
} from "./death-event";
import { computeHypotheticalEstateTax } from "./what-if/hypothetical-estate-tax";
import { calcSeca } from "../lib/tax/fica";
import { resolveCashValueForYear } from "./life-insurance-schedule";
import { computeTermEndYear } from "./life-insurance-expiry";
import { applyTrustAnnualPass, type NonGrantorTrustInput } from "./trust-tax/index";
import {
  computeAnnualUnitrustPayment,
  computeClutRecapture,
  distributeAtTermination,
  isTrustTerminationYear,
  type TrustTerminationResult,
} from "./trust-split-interest";
import type { AccountYearRealization, AssetTransactionGain } from "./trust-tax/collect-trust-income";
import type { TrustLiquidityPool, TrustIncomeBuckets, TrustWarning, DistributionPolicy } from "./trust-tax/types";
import { computeDistribution } from "./trust-tax/compute-distribution";
import {
  normalizeOwners,
  ownedByHouseholdAtYear,
  ownedByEntityAtYear,
  ownersForYear,
  liabilityOwnedByHouseholdAtYear,
  liabilityOwnersForYear,
  isFullyEntityOwned,
  controllingFamilyMember,
  controllingEntity,
} from "./ownership";
import {
  computeBusinessEntityNetIncome,
  resolveEntityFlowAmount,
  resolveDistributionPercent,
} from "./entity-flows";
import { type CharityBucket } from "./charitable-deduction";
import {
  emptyCharityCarryforward,
  type CharityCarryforward,
} from "./types";
import { computeTaxForYear } from "./year-tax";

// Map legacy income type to the new tax type categories.
function legacyTaxType(
  incomeType: string
): "earned_income" | "ordinary_income" | "dividends" | "capital_gains" | "qbi" | "tax_exempt" | "stcg" {
  switch (incomeType) {
    case "salary": return "earned_income";
    case "social_security": return "ordinary_income";
    case "business": return "ordinary_income";
    case "deferred": return "ordinary_income";
    case "capital_gains": return "capital_gains";
    case "trust": return "ordinary_income";
    default: return "ordinary_income";
  }
}

// Tax-efficiency ranking by category alone — Cash → Taxable → Tax-Deferred → Roth.
// Returns null for categories that can't be cleanly liquidated at year boundaries
// (real estate, business, life insurance). Shared by household and entity-scoped
// withdrawal strategies; callers layer on their own ownership / default-checking
// exclusions before consulting it.
function categoryWithdrawalPriority(acct: Account): number | null {
  if (acct.category === "cash") return 1;
  if (acct.category === "taxable") return 2;
  if (acct.category === "retirement") {
    if (acct.subType === "roth_ira") return 4;
    // traditional_ira, 401k, 403b, 529, deferred, other → tax-deferred bucket
    return 3;
  }
  return null;
}

// Tax-efficiency ranking applied when the user hasn't configured a withdrawal
// strategy. Household checking is excluded because it's the target account,
// not a source. Entity-owned accounts are excluded because they sit under
// step 12c's per-entity gap-fill, not the household pool.
function defaultWithdrawalPriorityFor(acct: Account): number | null {
  if (controllingEntity(acct) != null) return null;
  if (acct.isDefaultChecking) return null;
  return categoryWithdrawalPriority(acct);
}

// Mirror of `buildDefaultWithdrawalStrategy` scoped to a single entity. Used by
// step 12c to build a per-entity liquidation order when the entity's checking
// goes negative. Excludes the entity's own default-checking and the untappable
// categories baked into `categoryWithdrawalPriority`.
function buildEntityWithdrawalStrategy(
  entityId: string,
  accounts: Account[],
  planSettings: PlanSettings,
): WithdrawalPriority[] {
  const strategy: WithdrawalPriority[] = [];
  const valueById = new Map(accounts.map((a) => [a.id, a.value ?? 0]));
  for (const acct of accounts) {
    if (controllingEntity(acct) !== entityId) continue;
    if (acct.isDefaultChecking) continue;
    const priority = categoryWithdrawalPriority(acct);
    if (priority == null) continue;
    strategy.push({
      accountId: acct.id,
      priorityOrder: priority,
      startYear: planSettings.planStartYear,
      endYear: planSettings.planEndYear,
    });
  }
  // Largest balance first within a tier — same heuristic the household default uses.
  strategy.sort((a, b) => {
    if (a.priorityOrder !== b.priorityOrder) return a.priorityOrder - b.priorityOrder;
    return (valueById.get(b.accountId) ?? 0) - (valueById.get(a.accountId) ?? 0);
  });
  return strategy;
}

function buildDefaultWithdrawalStrategy(
  accounts: Account[],
  planSettings: PlanSettings
): WithdrawalPriority[] {
  const strategy: WithdrawalPriority[] = [];
  for (const acct of accounts) {
    const priority = defaultWithdrawalPriorityFor(acct);
    if (priority == null) continue;
    strategy.push({
      accountId: acct.id,
      priorityOrder: priority,
      startYear: planSettings.planStartYear,
      endYear: planSettings.planEndYear,
    });
  }
  // Within a priority bucket, draw from the largest balance first so we don't empty a
  // small account on year one and then have to re-sort order to reach the next tier.
  strategy.sort((a, b) => {
    if (a.priorityOrder !== b.priorityOrder) return a.priorityOrder - b.priorityOrder;
    const va = accounts.find((x) => x.id === a.accountId)?.value ?? 0;
    const vb = accounts.find((x) => x.id === b.accountId)?.value ?? 0;
    return vb - va;
  });
  return strategy;
}

// Build a per-year §2503(b) annual gift exclusion lookup from the loaded tax-year
// rows. Drizzle returns pg-numeric columns as strings; we coerce to number once at
// the engine boundary so the death-event module can keep its pure shape
// `Record<number, number>`.
function buildAnnualExclusionsMap(
  rows: Array<{ year: number; giftAnnualExclusion?: string | null }>,
): Record<number, number> {
  const map: Record<number, number> = {};
  for (const r of rows) {
    if (r.giftAnnualExclusion != null) {
      map[r.year] = parseFloat(r.giftAnnualExclusion);
    }
  }
  return map;
}

export interface ProjectionOptions {
  /**
   * Monte Carlo return injection. When provided and the override returns a
   * finite number, that rate is used instead of `acct.growthRate` for the
   * account's growth pass in that year. When the override returns `undefined`,
   * the account falls back to its fixed `growthRate` (per the eMoney
   * whitepaper's "custom growth rates remain fixed for Monte Carlo" rule).
   *
   * Left unset, `runProjection` behaves exactly as before — deterministic
   * path is byte-identical.
   */
  returnsOverride?: (year: number, accountId: string) => number | undefined;
}

export function runProjection(data: ClientData, options?: ProjectionOptions): ProjectionYear[] {
  const { client, planSettings } = data;
  const years: ProjectionYear[] = [];

  // Normalize ownership: any account/liability whose `owners[]` is empty (legacy
  // engine-test fixtures predating Phase 2 fractional ownership) gets a single
  // 100% row derived from legacy fields (owner/ownerEntityId/ownerFamilyMemberId)
  // that may still exist on test fixture objects (LegacyOwnedThing bridge in
  // src/engine/ownership.ts). Production data from `loadClientData` already
  // arrives with `owners[]` populated from the `account_owners` /
  // `liability_owners` junction tables — for that path this is a no-op. After
  // this step, every downstream ownership read can use `owners[]` exclusively
  // (see src/engine/ownership.ts helpers).
  data = {
    ...data,
    accounts: data.accounts.map(normalizeOwners),
    liabilities: data.liabilities.map(normalizeOwners),
  };

  const taxYearRows: TaxYearParameters[] = data.taxYearRows ?? [];
  if (planSettings.taxEngineMode === "bracket" && taxYearRows.length === 0) {
    console.warn(
      "[tax engine] Bracket mode selected but no tax_year_parameters rows available. " +
      "Falling back to flat mode. Run `npm run seed:tax-data` to populate."
    );
  }
  const taxResolver = taxYearRows.length > 0
    ? createTaxResolver(taxYearRows, {
        taxInflationRate: planSettings.taxInflationRate != null
          ? planSettings.taxInflationRate
          : planSettings.inflationRate,
        ssWageGrowthRate: planSettings.ssWageGrowthRate != null
          ? planSettings.ssWageGrowthRate
          : planSettings.inflationRate + 0.005,
      })
    : null;

  // Mutable working list of entities. Death-event grantor-succession can flip
  // an irrevocable grantor trust (IDGT/SLAT) to non-grantor at IRC §671 when
  // its grantor dies; downstream year-loop reads must see the post-flip
  // classification. `currentEntities` is reassigned after each death event;
  // the lookup map is rebuilt to match.
  let currentEntities: EntitySummary[] = data.entities ?? [];
  let entityMap: Record<string, EntitySummary> = {};
  const rebuildEntityMap = () => {
    entityMap = {};
    for (const e of currentEntities) entityMap[e.id] = e;
  };
  rebuildEntityMap();

  const isGrantorEntity = (entityId: string | undefined): boolean =>
    entityId != null && entityMap[entityId]?.isGrantor === true;

  // Effective withdrawal strategy. If the user hasn't configured anything, fall back
  // to a tax-efficient default: Cash → Taxable → Tax-Deferred → Roth. Illiquid
  // categories (real estate, business, life insurance) and default-checking accounts
  // are skipped. The household checking is always the target, never a source.
  const effectiveWithdrawalStrategy =
    data.withdrawalStrategy.length > 0
      ? data.withdrawalStrategy
      : buildDefaultWithdrawalStrategy(data.accounts, planSettings);

  // Default checking accounts — household and one per entity. When present, all
  // household cash flows through the household checking; entity cash through the
  // entity's own checking. When the household checking is absent we fall back to
  // the legacy surplus/deficit model (preserves tests + pre-migration data).
  // Migration 0055's default-checking trigger guarantees `isDefaultChecking`
  // accounts are either fully household-owned OR have exactly one entity
  // owner (never mixed), so the find-and-assert below is safe.
  const defaultChecking = data.accounts.find(
    (a) => a.isDefaultChecking && !isFullyEntityOwned(a)
  );
  const hasChecking = defaultChecking != null;
  const entityCheckingByEntityId: Record<string, string> = {};
  for (const a of data.accounts) {
    if (!a.isDefaultChecking) continue;
    if (!isFullyEntityOwned(a)) continue;
    const entityOwner = a.owners.find((o) => o.kind === "entity") as
      | { kind: "entity"; entityId: string; percent: number }
      | undefined;
    if (entityOwner) entityCheckingByEntityId[entityOwner.entityId] = a.id;
  }

  // Trust classification builders. Re-run each year against `currentEntities`
  // so a grantor-succession flip at first/final death (IDGT post-grantor-death,
  // revocable-on-grantor-death) propagates into the trust-tax pass starting the
  // year after the death event.
  const familyMemberMap = new Map(
    (data.familyMembers ?? []).map((fm) => [fm.id, fm])
  );
  const deriveBeneficiaryKind = (
    e: import("./types").EntitySummary
  ): "household" | "non_household" | null => {
    const list = e.incomeBeneficiaries ?? [];
    // householdRole (client/spouse) and familyMemberId entries are all treated
    // as household for distribution routing (same umbrella as the 1040 pass).
    const hasHousehold = list.some(
      (b) =>
        b.householdRole === "client" ||
        b.householdRole === "spouse" ||
        (b.familyMemberId != null && familyMemberMap.has(b.familyMemberId))
    );
    if (hasHousehold) return "household";
    const hasExternal = list.some((b) => b.externalBeneficiaryId != null);
    if (hasExternal) return "non_household";
    return null;
  };
  // Irrevocable, non-grantor trusts → their own annual tax pass (compressed 1041).
  const buildNonGrantorTrusts = (entities: EntitySummary[]): NonGrantorTrustInput[] =>
    entities
      .filter(
        (e) =>
          e.entityType === "trust" &&
          e.isIrrevocable === true &&
          e.isGrantor === false
      )
      .map((e) => ({
        entityId: e.id,
        isGrantorTrust: false,
        distributionPolicy: {
          mode: (e.distributionMode ?? null) as "fixed" | "pct_liquid" | "pct_income" | null,
          amount: e.distributionAmount ?? null,
          percent: e.distributionPercent ?? null,
          beneficiaryKind: deriveBeneficiaryKind(e),
          beneficiaryFamilyMemberId: null,
          beneficiaryExternalId: null,
        },
        incomeBeneficiaries: e.incomeBeneficiaries ?? [],
        trustCashStart: 0, // not used by orchestrator yet — kept for future expansion
      }));

  // Grantor irrevocable trusts (IDGT/SLAT) — income already flows through the
  // household 1040 (isGrantor=true), so there is no trust-level tax. The only
  // mechanic here is an optional cash distribution: trust checking → household
  // (or out of scope).
  interface GrantorTrustEntry {
    entityId: string;
    policy: DistributionPolicy;
  }
  const buildGrantorTrusts = (entities: EntitySummary[]): GrantorTrustEntry[] =>
    entities
      .filter(
        (e) =>
          e.entityType === "trust" &&
          e.isIrrevocable === true &&
          e.isGrantor === true &&
          e.distributionMode != null &&
          deriveBeneficiaryKind(e) !== null
      )
      .map((e) => ({
        entityId: e.id,
        policy: {
          mode: e.distributionMode as "fixed" | "pct_liquid" | "pct_income",
          amount: e.distributionAmount ?? null,
          percent: e.distributionPercent ?? null,
          beneficiaryKind: deriveBeneficiaryKind(e),
          beneficiaryFamilyMemberId: null,
          beneficiaryExternalId: null,
        },
      }));

  // Resolve the cash account that an income/expense/liability should settle against:
  // an explicit override wins, otherwise fall back to the default checking for the
  // appropriate owner.
  const resolveCashAccount = (
    ownerEntityId: string | undefined,
    overrideId?: string
  ): string | undefined => {
    if (overrideId) return overrideId;
    if (ownerEntityId) return entityCheckingByEntityId[ownerEntityId];
    return defaultChecking?.id;
  };

  // Best cash destination for a given family member. Used to route entity
  // distributions to the actual owner's account rather than to whichever
  // isDefaultChecking account .find() returns first. Scoring: isDefaultChecking
  // dominates, then cash category, then ownership share — so a singly-owned
  // account beats a joint one when both are flagged default.
  const resolveFamilyMemberDefaultCash = (fmId: string): string | undefined => {
    let best: { id: string; score: number } | null = null;
    for (const a of data.accounts) {
      if (isFullyEntityOwned(a)) continue;
      const myOwnership = a.owners.find(
        (o) => o.kind === "family_member" && o.familyMemberId === fmId,
      );
      if (!myOwnership) continue;
      const score =
        (a.isDefaultChecking ? 1000 : 0) +
        (a.category === "cash" ? 100 : 0) +
        myOwnership.percent;
      if (!best || score > best.score) {
        best = { id: a.id, score };
      }
    }
    return best?.id;
  };

  // Mutable state that carries across years
  const accountBalances: Record<string, number> = {};
  for (const acct of data.accounts) {
    accountBalances[acct.id] = acct.value;
  }

  // Per-year end-of-year balance snapshots. Keyed by year so death-event
  // accountValueAtYear callbacks can return the gift-year balance instead of
  // always the death-year balance. Populated just before years.push().
  const yearEndAccountBalances = new Map<number, Record<string, number>>();

  // Basis tracking for transfers and sales
  const basisMap: Record<string, number> = {};
  for (const acct of data.accounts) {
    basisMap[acct.id] = acct.basis;
  }

  // Roth value tracking for 401k/403b accounts. Mirrors basisMap shape so
  // every account has an entry (0 for non-401k/403b). Grows alongside the
  // account each year and decrements pro-rata on withdrawals / Roth
  // conversions out.
  const rothValueMap: Record<string, number> = {};
  for (const acct of data.accounts) {
    rothValueMap[acct.id] = acct.rothValue ?? 0;
  }

  // Mutable accounts list — techniques can add/remove accounts
  let workingAccounts = [...data.accounts];

  // Invariant account-id → Account map for ownership lookups that must
  // survive the BoY sale step's account removal. Trust-tax routing for
  // asset-transaction sales needs `ownerEntityId` for accounts that were
  // removed from `workingAccounts` earlier in the same year, so we source
  // from `data.accounts` (which never changes). Synthetic accounts created
  // by BoY purchases are always household-owned (no ownerEntityId) — see
  // asset-transactions.ts applyAssetPurchases — so omitting them preserves
  // correct fall-through behavior for household sales.
  //
  // Unlike `entityMap` (which is rebuilt after each death event), this map
  // is built once and never refreshed. CAVEAT: the death-event paths below
  // can reassign `workingAccounts` from `applyFirstDeath` / `applyFinalDeath`
  // results, which may include new trust-owned accounts (e.g., testamentary
  // trust funding). Sales of those death-spawned accounts in subsequent
  // projection years would not resolve here and would misroute to household.
  // Tracked in future-work/engine.md ("Death-spawned trust-owned accounts
  // misroute on subsequent asset-transaction sales") until addressed.
  const accountById = new Map(data.accounts.map((a) => [a.id, a]));

  // Reset synthetic ID counter for technique-created assets
  _resetSyntheticIdCounter();

  // Monthly amortization schedule per liability, keyed by id. Built once at
  // init for pre-existing liabilities and extended inline when BoY purchases
  // create new mortgages mid-projection. Authoritative source for BoY/EoY
  // balances, payments, and interest — replaces the previous simplified
  // annual amortization so engine numbers match the balance sheet / tab.
  const liabilitySchedules: LiabilityScheduleMap = buildLiabilitySchedules(
    data.liabilities,
  );

  // Starting balance for each liability is the BoY balance at planStartYear
  // from its schedule — not the raw DB balance, which may be as-of a
  // different year (e.g. loan origination).
  let currentLiabilities: Liability[] = data.liabilities.map((l) => {
    const sched = liabilitySchedules.get(l.id);
    const boyBalance = sched
      ? scheduleBoYBalance(sched, planSettings.planStartYear)
      : l.balance;
    return { ...l, balance: boyBalance };
  });

  const clientBirthYear = parseInt(client.dateOfBirth.slice(0, 4), 10);
  const spouseBirthYear = client.spouseDob
    ? parseInt(client.spouseDob.slice(0, 4), 10)
    : undefined;

  // Household principal FM ids — used to route account ownership checks that
  // previously relied on acct.owner === "client" / "spouse".
  const clientFmId = (data.familyMembers ?? []).find((fm) => fm.role === "client")?.id ?? null;
  const spouseFmId = (data.familyMembers ?? []).find((fm) => fm.role === "spouse")?.id ?? null;

  /** Returns true if `acct` is controlled 100% by the spouse FM. */
  const isSpouseAccount = (acct: { owners: import("./ownership").AccountOwner[] }): boolean => {
    if (!spouseFmId) return false;
    return controllingFamilyMember(acct) === spouseFmId;
  };

  const firstDeathYear = computeFirstDeathYear(
    client,
    planSettings.planStartYear,
    planSettings.planEndYear,
  );
  const firstDeathDeceased =
    firstDeathYear != null ? identifyDeceased(client, firstDeathYear) : null;
  const firstDeathSurvivor: "client" | "spouse" | null =
    firstDeathDeceased === "client" ? "spouse" : firstDeathDeceased === "spouse" ? "client" : null;

  const finalDeathYear = computeFinalDeathYear(
    client,
    planSettings.planStartYear,
    planSettings.planEndYear,
  );
  const finalDeceased: "client" | "spouse" | null =
    finalDeathYear != null
      ? identifyFinalDeceased(client, firstDeathDeceased)
      : null;

  // DSUE generated by the first death is stashed here so the final-death call
  // can claim it via §2010(c)(4) portability. Stays 0 for the single-filer path
  // (no first-death event fires, so no DSUE is ever generated).
  let stashedDSUE = 0;

  let currentIncomes: Income[] = [...data.incomes];
  // Snapshot of the year's resolved `allExpenses` (data.expenses + synthetic
  // property-tax rows). Captured each iteration so the post-loop entity
  // cash-flow pass can read entity-tagged synthetic expenses.
  let lastAllExpenses: Expense[] = data.expenses;

  const annualExclusionsByYear = buildAnnualExclusionsMap(data.taxYearRows ?? []);
  let charityCarryforward: CharityCarryforward = emptyCharityCarryforward();

  // Cap-gains realized by step 12c (entity gap-fill) liquidations of trust-owned
  // taxable accounts. Tax on the gain is recognized in the FOLLOWING year — at
  // gap-fill time the trust marginal rate isn't available (trust-tax pass has
  // already run for the current year), so the gain is stashed here and drained
  // at the start of the next year. Non-grantor entries flow into that year's
  // `assetTransactionGains` (trust pays its own 1041 cap-gains tax). Grantor
  // entries flow into household `taxDetail.capitalGains` (taxed at 1040). The
  // grantor / non-grantor decision is re-evaluated at drain time using the
  // entity's CURRENT-year status — a death-event grantor flip in the
  // intervening year correctly redirects the gain.
  const deferredEntityLiquidationGains: Array<{
    entityId: string;
    accountId: string;
    gain: number;
  }> = [];

  // Cross-year record of actual unitrust payments made by each CLUT, ordered
  // year-by-year from inception. Drained by the §170(f)(2)(B) recapture pass
  // when a grantor of a CLUT dies mid-term — the PV of these payments at the
  // original §7520 rate is subtracted from the original income-interest
  // deduction to compute recapture as ordinary income on the final 1040.
  const clutPaymentsByTrustId: Map<string, number[]> = new Map();

  // Per-year locked-share carry for split-owned accounts. Mirrors
  // computeEntityCashFlow's post-loop accounting so the in-loop death-event
  // path sees the same locked entity shares the post-loop pass would have
  // produced. Carry persists year-over-year; passive growth accrues
  // proportionally, household flows do not erode it.
  const lockedEntityShareCarry = new Map<string, Map<string, number>>();
  // Reserved for per-FM gross-estate attribution. Threaded through the
  // death-event pipeline alongside the entity carry but not yet populated —
  // computeGrossEstate doesn't consume the family-member side today.
  const lockedFamilyShareCarry = new Map<string, Map<string, number>>();

  for (
    let year = planSettings.planStartYear;
    year <= planSettings.planEndYear;
    year++
  ) {
    const ages = {
      client: year - clientBirthYear,
      spouse: spouseBirthYear != null ? year - spouseBirthYear : undefined,
    };

    // Re-classify trust lists each year against `currentEntities`. After a
    // grantor's death, an IDGT/SLAT flips isGrantor:true→false and migrates
    // from `grantorTrusts` to `nonGrantorTrusts`; a revocable trust likewise
    // gets reclassified. Recomputed inside the loop so the year following a
    // death event picks up the post-flip classification.
    const nonGrantorTrusts: NonGrantorTrustInput[] = buildNonGrantorTrusts(currentEntities);
    const grantorTrusts: GrantorTrustEntry[] = buildGrantorTrusts(currentEntities);

    // Drain prior-year entity-liquidation cap gains (step 12c carry-over).
    // Routed by the entity's CURRENT-year grantor status: grantor → household
    // 1040 cap-gains; non-grantor → trust-tax pass via assetTransactionGains.
    let grantorCarryInCapGains = 0;
    const nonGrantorCarryInGains: AssetTransactionGain[] = [];
    for (const g of deferredEntityLiquidationGains.splice(0)) {
      if (g.gain <= 0) continue;
      if (isGrantorEntity(g.entityId)) {
        grantorCarryInCapGains += g.gain;
      } else {
        nonGrantorCarryInGains.push({ ownerEntityId: g.entityId, gain: g.gain });
      }
    }

    // 1. Compute income breakdowns. Household and grantor-trust streams are kept
    // separate because grantor income flows to the entity checking but is still
    // taxable at the household rate.
    const income = computeIncome(
      currentIncomes,
      year,
      client,
      (inc) => inc.ownerEntityId == null
    );
    const grantorIncome = computeIncome(
      currentIncomes,
      year,
      client,
      (inc) => inc.ownerEntityId != null && isGrantorEntity(inc.ownerEntityId)
    );

    // 2. Household expenses (entity-owned expenses are paid by the entity).
    // Pass only real expenses — synthetic property-tax expenses (built later,
    // post-BoY transactions) are tracked separately in the realEstate bucket.
    const expenseBreakdown = computeExpenses(
      data.expenses,
      year,
      data.client,
      (exp) => exp.ownerEntityId == null
    );

    // Initialize per-account ledgers with the year-start balances. Ledgers are
    // populated first so that BoY sales/purchases (next) can append their entries
    // before the growth pass adds its own.
    const accountLedgers: Record<string, AccountLedger> = {};
    for (const acct of workingAccounts) {
      const beginningValue = accountBalances[acct.id] ?? 0;
      accountLedgers[acct.id] = {
        beginningValue,
        growth: 0,
        contributions: 0,
        distributions: 0,
        internalContributions: 0,
        internalDistributions: 0,
        rmdAmount: 0,
        fees: 0,
        endingValue: beginningValue,
        entries: [],
        basisBoY: basisMap[acct.id] ?? acct.basis,
        rothValueBoY: rothValueMap[acct.id] ?? acct.rothValue ?? 0,
      };
    }

    // Snapshot BoY state for UI previews (sale-form autofill). Captured before
    // sales/purchases so a UI reading year N sees the pre-transaction values.
    const accountBasisBoY: Record<string, number> = {};
    for (const acct of workingAccounts) {
      accountBasisBoY[acct.id] = basisMap[acct.id] ?? acct.basis;
    }
    // BoY balance pulled from each liability's schedule at `year`. For loans
    // originated before planStartYear this picks up the authoritative mid-
    // schedule balance; for loans that don't originate until a later year the
    // schedule lookup still returns the correct value (or zero after payoff).
    const liabilityBalancesBoY: Record<string, number> = {};
    for (const liab of currentLiabilities) {
      const sched = liabilitySchedules.get(liab.id);
      const boy = sched ? scheduleBoYBalance(sched, year) : liab.balance;
      liabilityBalancesBoY[liab.id] = boy;
      // Keep liab.balance aligned with BoY so applyAssetSales (which reads
      // linkedMortgage.balance) pays off the correct amount.
      liab.balance = boy;
    }

    // ── BoY: Asset Sales ─────────────────────────────────────────────────────
    // Sales happen on the first day of the year: the sold asset doesn't earn
    // growth this year, and sale proceeds land in the cash account in time to
    // earn the year's cash growth.
    let saleResult = {
      capitalGains: 0,
      homeSaleExclusionTotal: 0,
      removedAccountIds: [] as string[],
      removedLiabilityIds: [] as string[],
      breakdown: [] as { transactionId: string; accountId: string; saleValue: number; basis: number; transactionCosts: number; netProceeds: number; capitalGain: number; homeSaleExclusionApplied: number; taxableCapitalGain: number; mortgagePaidOff: number; proceedsAccountId: string }[],
    };
    if (data.assetTransactions && data.assetTransactions.length > 0) {
      const sales = data.assetTransactions.filter((t) => t.type === "sell");
      if (sales.length > 0) {
        saleResult = applyAssetSales({
          sales,
          accounts: workingAccounts,
          liabilities: currentLiabilities,
          accountBalances,
          basisMap,
          accountLedgers,
          year,
          defaultCheckingId: defaultChecking?.id ?? "",
          filingStatus: effectiveFilingStatus(
            (client.filingStatus ?? "single") as FilingStatus,
            firstDeathYear,
            year,
          ),
        });

        if (saleResult.removedAccountIds.length > 0) {
          const removed = new Set(saleResult.removedAccountIds);
          workingAccounts = workingAccounts.filter((a) => !removed.has(a.id));
        }

        if (saleResult.removedLiabilityIds.length > 0) {
          const removed = new Set(saleResult.removedLiabilityIds);
          currentLiabilities = currentLiabilities.filter((l) => !removed.has(l.id));
        }
      }
    }

    // ── BoY: Asset Purchases ─────────────────────────────────────────────────
    // Purchases happen on the first day of the year: equity leaves the funding
    // account immediately, and the newly-bought asset earns a full year of
    // growth. If a paired sale funded the purchase, its proceeds are already in
    // the cash account from the sale step above.
    let purchaseBreakdown: { transactionId: string; name: string; equity: number; purchasePrice: number; mortgageAmount: number; fundingAccountId: string; liabilityId?: string; liabilityName?: string }[] = [];
    if (data.assetTransactions && data.assetTransactions.length > 0) {
      const purchases = data.assetTransactions.filter((t) => t.type === "buy");
      if (purchases.length > 0) {
        const purchaseResult = applyAssetPurchases({
          purchases,
          accounts: workingAccounts,
          liabilities: currentLiabilities,
          accountBalances,
          basisMap,
          accountLedgers,
          year,
          defaultCheckingId: defaultChecking?.id ?? "",
        });

        purchaseBreakdown = purchaseResult.breakdown;
        for (const newAcct of purchaseResult.newAccounts) {
          workingAccounts.push(newAcct);
        }
        for (const newLiab of purchaseResult.newLiabilities) {
          currentLiabilities.push(newLiab);
          // Build a schedule for the new mortgage starting at its origination
          // year (== this projection year). BoY balance == mortgageAmount.
          liabilitySchedules.set(newLiab.id, buildLiabilitySchedule(newLiab));
        }
      }
    }

    // Inject synthetic property-tax expenses for real estate accounts. Built
    // after BoY sales/purchases so a sold property is excluded and a newly-
    // bought property contributes a full year of property tax.
    // Property tax is split by ownership: the household share goes into the
    // household synthetic expense (no ownerEntityId — routes to defaultChecking
    // via resolveCashAccount and lands in the realEstate bucket); each entity
    // owner's share emits its own synthetic expense tagged with that entity's
    // id so it routes to the entity's checking via the existing entity-expense
    // path. Synthetic ids stay deterministic for downstream consumers (PDF
    // export, drill-down UI).
    const syntheticExpenses: typeof data.expenses = [];
    for (const acct of workingAccounts) {
      if (acct.category !== "real_estate") continue;
      const propTax = acct.annualPropertyTax ?? 0;
      if (propTax <= 0) continue;
      const elapsed = year - planSettings.planStartYear;
      const inflated = propTax * Math.pow(1 + (acct.propertyTaxGrowthRate ?? 0.03), Math.max(0, elapsed));
      // T9: use year-aware helpers so gift events that transferred real-estate
      // ownership to an entity are reflected in the correct year's property-tax
      // routing (household vs entity synthetic expense rows).
      const propTaxYearOwners = ownersForYear(acct, data.giftEvents, year, planSettings.planStartYear);
      const householdShare = propTaxYearOwners
        .filter((o) => o.kind === "family_member")
        .reduce((s, o) => s + o.percent, 0);
      if (householdShare > 0) {
        syntheticExpenses.push({
          id: `synth-proptax-${acct.id}`,
          type: "other",
          name: `Property Tax – ${acct.name}`,
          annualAmount: inflated * householdShare,
          startYear: planSettings.planStartYear,
          endYear: planSettings.planEndYear,
          growthRate: 0, // already inflated
        });
      }
      for (const owner of propTaxYearOwners) {
        if (owner.kind !== "entity") continue;
        if (owner.percent <= 0) continue;
        syntheticExpenses.push({
          id: `synth-proptax-${acct.id}-${owner.entityId}`,
          type: "other",
          name: `Property Tax – ${acct.name}`,
          annualAmount: inflated * owner.percent,
          startYear: planSettings.planStartYear,
          endYear: planSettings.planEndYear,
          growthRate: 0,
          ownerEntityId: owner.entityId,
        });
      }
    }
    const allExpenses = [...data.expenses, ...syntheticExpenses];
    lastAllExpenses = allExpenses;

    // 3. Liability payments — amortize all liabilities (so balances roll forward),
    // and keep the per-liability map so entity liability payments can be routed
    // to entity checking below. The internal filter is a no-op (the household
    // total it computes is recomputed below from fractional shares so each
    // liability contributes only its household-owned percentage). Runs after
    // BoY sales/purchases so sold-asset mortgages are already removed and new
    // mortgages from purchases are included for a full year of payments.
    const liabResult = computeLiabilities(
      currentLiabilities,
      year,
      () => false, // skip computeLiabilities's internal totalPayment — recomputed pro-rata below
      liabilitySchedules,
    );
    currentLiabilities = liabResult.updatedLiabilities;
    // Household share of total liability service: each liability contributes
    // liabilityOwnedByHouseholdAtYear(liab) × annualPayment. Entity portions
    // route to entity checking via the per-liability cash routing block below.
    // T9: use year-aware helper so gift events that transferred liability
    // ownership to an entity are reflected in the correct year's debt-service total.
    {
      let total = 0;
      for (const liab of currentLiabilities) {
        const payment = liabResult.byLiability[liab.id] ?? 0;
        if (payment === 0) continue;
        total += payment * liabilityOwnedByHouseholdAtYear(liab, data.giftEvents, year, planSettings.planStartYear);
      }
      liabResult.totalPayment = total;
    }

    // Life-insurance cash-value schedule override (free-form mode). The schedule
    // is authoritative for the year, replacing whatever growth model the account
    // would otherwise use. Basic-mode policies fall through to the normal
    // growth loop, unchanged.
    const scheduleOverriddenAccounts = new Set<string>();
    for (const acct of workingAccounts) {
      if (
        acct.category === "life_insurance" &&
        acct.lifeInsurance &&
        acct.lifeInsurance.cashValueGrowthMode === "free_form"
      ) {
        accountBalances[acct.id] = resolveCashValueForYear(
          acct.lifeInsurance.cashValueSchedule,
          year,
        );
        scheduleOverriddenAccounts.add(acct.id);
      }
    }

    // Term-policy retirement: drop policies whose last-in-force year is past.
    // The filter runs after the cash-value override so both apply in the same
    // pre-growth phase.
    workingAccounts = workingAccounts.filter((acct) => {
      if (acct.category !== "life_insurance" || !acct.lifeInsurance) return true;
      if (acct.lifeInsurance.policyType !== "term") return true;

      const endYear = computeTermEndYear({
        policy: acct.lifeInsurance,
        insured: acct.insuredPerson ?? "client",
        client,
      });

      if (endYear == null) return true;
      if (year > endYear) {
        delete accountBalances[acct.id];
        return false;
      }
      return true;
    });

    // 4. Grow every account (post-BoY: sold accounts are gone, newly-bought
    // accounts are included). When the account has a realization model, split
    // growth into tax buckets: OI, QDiv, STCG, LTCG, Tax-Exempt. Turnover %
    // determines the ST/LT CG split. Taxable amounts are added to the year's
    // tax detail; basis is increased for everything except LTCG.
    let realizationOI = 0;
    let realizationQDiv = 0;
    let realizationSTCG = 0;
    const realizationBySource: Record<string, { type: string; amount: number }> = {};
    // Per-account realization entries for the trust-tax pass. Populated for
    // non-grantor trust accounts only; the orchestrator aggregates by ownerEntityId.
    const yearRealizations: AccountYearRealization[] = [];

    // Per-entity income buckets for grantor irrevocable trusts. Grantor-trust
    // income already flows through the household 1040 (handled below), but for
    // pct_income distribution mode we still need the trust's total income so
    // computeDistribution can derive the target amount.
    const grantorTrustIncomeByEntity = new Map<string, TrustIncomeBuckets>();
    for (const gt of grantorTrusts) {
      grantorTrustIncomeByEntity.set(gt.entityId, { ordinary: 0, dividends: 0, taxExempt: 0, recognizedCapGains: 0 });
    }

    for (const acct of workingAccounts) {
      const currentBalance = accountBalances[acct.id] ?? 0;
      if (scheduleOverriddenAccounts.has(acct.id)) continue;
      const overriddenRate = options?.returnsOverride?.(year, acct.id);
      const effectiveGrowthRate =
        overriddenRate != null && Number.isFinite(overriddenRate)
          ? overriddenRate
          : acct.growthRate;
      const growth = currentBalance * effectiveGrowthRate;

      // Defensive: ensure a ledger exists (applyAssetPurchases initializes one
      // for new accounts; this covers any edge case where it didn't).
      if (!accountLedgers[acct.id]) {
        accountLedgers[acct.id] = {
          beginningValue: currentBalance,
          growth: 0,
          contributions: 0,
          distributions: 0,
          internalContributions: 0,
          internalDistributions: 0,
          rmdAmount: 0,
          fees: 0,
          endingValue: currentBalance,
          entries: [],
          basisBoY: basisMap[acct.id] ?? acct.basis,
        };
      }

      if (growth === 0) continue;

      let growthDetail: AccountLedger["growthDetail"];

      if (acct.realization) {
        const r = acct.realization;
        const oi = growth * r.pctOrdinaryIncome;
        const qdiv = growth * r.pctQualifiedDividends;
        const rawLtcg = growth * r.pctLtCapitalGains;
        const stcg = rawLtcg * r.turnoverPct;
        const ltcg = rawLtcg - stcg;
        const taxExempt = growth * r.pctTaxExempt;
        // Basis increases for everything EXCEPT LTCG (unrealized appreciation)
        const basisIncrease = oi + qdiv + stcg + taxExempt;

        growthDetail = { ordinaryIncome: oi, qualifiedDividends: qdiv, stCapitalGains: stcg, ltCapitalGains: ltcg, taxExempt, basisIncrease };

        // Recognized in-year growth bumps cost basis on taxable & cash accounts —
        // those dollars were already taxed in-year via taxDetail, so on later sale
        // they must not be double-counted as cap gains. Retirement accounts defer
        // tax until withdrawal and use `basis` for post-tax contribution tracking,
        // not realization, so they stay flat here. (Audit F1.)
        if ((acct.category === "taxable" || acct.category === "cash") && basisIncrease > 0) {
          basisMap[acct.id] = (basisMap[acct.id] ?? 0) + basisIncrease;
        }

        // Only taxable accounts generate current-year tax from realization.
        // Retirement accounts defer all tax until withdrawal; cash accounts
        // are always 100% OI but that's baked into the realization model.
        if (acct.category === "taxable" || acct.category === "cash") {
          // Pro-rate each realization stream by ownership share. Use year-aware
          // owners so gift events that transfer ownership to a trust are reflected
          // in the correct year's dividend/interest/STCG routing (T8 — Phase 3).
          // Household and grantor-entity portions roll into household 1040 tax
          // detail. Non-grantor entity portions land on per-account realization
          // entries for the trust-tax pass to consume. Grantor-entity portions also
          // populate grantorTrustIncomeByEntity for pct_income distribution.
          const yearOwners = ownersForYear(acct, data.giftEvents, year, planSettings.planStartYear);
          const householdShare = yearOwners
            .filter((o) => o.kind === "family_member")
            .reduce((s, o) => s + o.percent, 0);
          let grantorShare = 0;
          for (const owner of yearOwners) {
            if (owner.kind !== "entity") continue;
            if (isGrantorEntity(owner.entityId)) grantorShare += owner.percent;
          }
          const householdLikeShare = householdShare + grantorShare;

          if (householdLikeShare > 0) {
            const oiHH = oi * householdLikeShare;
            const qdivHH = qdiv * householdLikeShare;
            const stcgHH = stcg * householdLikeShare;
            realizationOI += oiHH;
            realizationQDiv += qdivHH;
            realizationSTCG += stcgHH;
            if (oiHH > 0) realizationBySource[`${acct.id}:oi`] = { type: "ordinary_income", amount: oiHH };
            if (qdivHH > 0) realizationBySource[`${acct.id}:qdiv`] = { type: "dividends", amount: qdivHH };
            if (stcgHH > 0) realizationBySource[`${acct.id}:stcg`] = { type: "stcg", amount: stcgHH };
          }

          // Per grantor-entity owner: track its share for pct_income distribution.
          for (const owner of yearOwners) {
            if (owner.kind !== "entity") continue;
            if (!isGrantorEntity(owner.entityId)) continue;
            const bucket = grantorTrustIncomeByEntity.get(owner.entityId);
            if (bucket) {
              bucket.ordinary += oi * owner.percent;
              bucket.dividends += qdiv * owner.percent;
              bucket.taxExempt += taxExempt * owner.percent;
            }
          }

          // Per non-grantor-entity owner: emit a per-account realization entry
          // scaled by the entity's share of this account.
          for (const owner of yearOwners) {
            if (owner.kind !== "entity") continue;
            if (isGrantorEntity(owner.entityId)) continue;
            yearRealizations.push({
              accountId: acct.id,
              ownerEntityId: owner.entityId,
              ordinary: oi * owner.percent,
              dividends: qdiv * owner.percent,
              taxExempt: taxExempt * owner.percent,
              capGains: stcg * owner.percent, // ambient — collect-trust-income ignores this per convention
            });
          }
        }
      }

      accountLedgers[acct.id].growth += growth;
      accountLedgers[acct.id].endingValue += growth;
      accountLedgers[acct.id].entries.push({
        category: "growth",
        label: `Growth (${(effectiveGrowthRate * 100).toFixed(2)}%)`,
        amount: growth,
      });
      if (growthDetail) accountLedgers[acct.id].growthDetail = growthDetail;

      accountBalances[acct.id] = currentBalance + growth;

      // Roth value tracks balance growth at the same rate so the
      // rothValue/balance ratio stays constant absent contributions or
      // withdrawals. Only meaningful for 401k/403b — non-retirement
      // entries hold 0 and stay 0.
      const rothBefore = rothValueMap[acct.id] ?? 0;
      if (rothBefore > 0) {
        rothValueMap[acct.id] = rothBefore + rothBefore * effectiveGrowthRate;
      }
    }

    // Per-account cash deltas plus per-account entry lists for this year. A "credit"
    // with a positive amount is an inflow; negative is an outflow. The entries list
    // gives the ledger modal something to show beyond the summed totals.
    const cashDelta: Record<string, number> = {};
    const pendingEntries: Record<string, AccountLedgerEntry[]> = {};
    const creditCash = (
      acctId: string | undefined,
      amount: number,
      entry?: Omit<AccountLedgerEntry, "amount">
    ) => {
      if (!acctId || amount === 0) return;
      cashDelta[acctId] = (cashDelta[acctId] ?? 0) + amount;
      if (entry) {
        (pendingEntries[acctId] ??= []).push({ ...entry, amount });
      }
    };

    // ── Apply Transfers ─────────────────────────────────────────────────────
    let transferResult = {
      taxableOrdinaryIncome: 0,
      capitalGains: 0,
      earlyWithdrawalPenalty: 0,
      byTransfer: {} as Record<string, { amount: number; label: string }>,
    };
    if (data.transfers && data.transfers.length > 0) {
      transferResult = applyTransfers({
        transfers: data.transfers,
        accounts: workingAccounts,
        accountBalances,
        basisMap,
        rothValueMap,
        accountLedgers,
        year,
        ownerAges: { client: ages.client, spouse: ages.spouse },
        spouseFamilyMemberId: spouseFmId,
      });
    }

    // 4b. RMDs. Source account balance is decremented; the cash lands in the
    // appropriate checking (household or entity) via cashDelta. Tax treatment:
    // household → household tax; grantor entity → household tax; other entity →
    // no household tax (entity handles its own, not modeled yet).
    let householdRmdIncome = 0;
    let grantorRmdTaxable = 0;
    const rmdBySource: Record<string, { type: string; amount: number }> = {};
    for (const acct of workingAccounts) {
      if (!acct.rmdEnabled) continue;
      let ownerBirthYear: number;
      if (isSpouseAccount(acct) && spouseBirthYear != null) {
        ownerBirthYear = spouseBirthYear;
      } else {
        ownerBirthYear = clientBirthYear;
      }
      const ownerAge = year - ownerBirthYear;
      // IRS RMD rule: divisor × prior-year-Dec-31 balance. That's BoY of this
      // year (before growth/transfers), captured on the ledger as
      // `beginningValue`. Using the post-growth current balance slightly
      // overstates the required amount in up markets.
      //
      // Year-1 override: when `acct.value` is entered mid-year it isn't a
      // true Dec-31 snapshot, which throws off Year-1 RMDs vs the custodian's
      // letter. `priorYearEndValue`, if provided, replaces beginningValue for
      // the first projection year only — Year 2+ uses the engine's own
      // year-end balances.
      const isFirstProjectionYear = year === planSettings.planStartYear;
      const rmdBasis =
        isFirstProjectionYear && acct.priorYearEndValue != null
          ? acct.priorYearEndValue
          : accountLedgers[acct.id]?.beginningValue ?? accountBalances[acct.id] ?? 0;
      const currentBalance = accountBalances[acct.id] ?? 0;
      const rmd = Math.min(currentBalance, calculateRMD(rmdBasis, ownerAge, ownerBirthYear));
      if (rmd <= 0) continue;

      accountBalances[acct.id] = currentBalance - rmd;
      if (accountLedgers[acct.id]) {
        accountLedgers[acct.id].rmdAmount = rmd;
        accountLedgers[acct.id].distributions += rmd;
        accountLedgers[acct.id].endingValue -= rmd;
        accountLedgers[acct.id].entries.push({
          category: "rmd",
          label: `RMD distribution (age ${ownerAge})`,
          amount: -rmd,
        });
      }

      // Retirement accounts are required to have a single owner (DB CHECK
      // trigger in migration 0055). Route the RMD via that single owner —
      // either the controlling family member (→ household) or the lone entity
      // (→ entity checking, with grantor pass-through to household tax).
      const rmdLabel = `RMD from ${acct.name}`;
      const householdOwner = controllingFamilyMember(acct);
      if (householdOwner != null) {
        householdRmdIncome += rmd;
        rmdBySource[`${acct.id}:rmd`] = { type: "ordinary_income", amount: rmd };
        creditCash(defaultChecking?.id, rmd, { category: "rmd", label: rmdLabel, sourceId: acct.id });
      } else if (isFullyEntityOwned(acct)) {
        const entityOwner = acct.owners.find((o) => o.kind === "entity") as
          | { kind: "entity"; entityId: string; percent: number }
          | undefined;
        if (!entityOwner) {
          throw new Error(
            `RMD-enabled retirement account ${acct.id} (${acct.name}) is fully-entity-owned but has no entity owner row`,
          );
        }
        creditCash(entityCheckingByEntityId[entityOwner.entityId], rmd, {
          category: "rmd",
          label: rmdLabel,
          sourceId: acct.id,
        });
        if (isGrantorEntity(entityOwner.entityId)) {
          grantorRmdTaxable += rmd;
          rmdBySource[`${acct.id}:rmd`] = { type: "ordinary_income", amount: rmd };
        }
      } else {
        throw new Error(
          `RMD-enabled retirement account ${acct.id} (${acct.name}) must have a single owner ` +
            `(controlling family member or fully entity-owned). Owners: ${JSON.stringify(acct.owners)}`,
        );
      }
    }

    // ── Apply Roth Conversions (technique) ──────────────────────────────────
    // Runs after RMDs so fill-up-bracket math sees the year's required RMD
    // income, and so Trad → Roth pro-rata is computed on post-RMD balances.
    let rothConversionResult = {
      taxableOrdinaryIncome: 0,
      earlyWithdrawalPenalty: 0,
      byConversion: {} as Record<string, { gross: number; taxable: number; bySource: Record<string, number> }>,
    };
    if (data.rothConversions && data.rothConversions.length > 0) {
      const convFilingStatus = effectiveFilingStatus(
        (client.filingStatus ?? "single") as FilingStatus,
        firstDeathYear,
        year,
      );
      const convResolved = taxResolver ? taxResolver.getYear(year) : null;
      const convBrackets = convResolved?.params.incomeBrackets[convFilingStatus];
      const convStdDeduction = convResolved?.params.stdDeduction[convFilingStatus] ?? 0;
      // Pre-conversion ordinary-income tax base: earned + STCG + ordinary divs +
      // transfer-induced OI + RMDs. Excludes qual-div / LTCG (they stack above
      // the OI bracket) and SS taxable portion (approximation — Fill-Up-Bracket
      // is most useful in pre-SS years).
      const preConversionOrdinaryIncome =
        income.salaries + income.business + income.deferred + income.trust +
        grantorIncome.salaries + grantorIncome.business + grantorIncome.deferred + grantorIncome.trust +
        realizationOI + realizationSTCG +
        transferResult.taxableOrdinaryIncome +
        householdRmdIncome + grantorRmdTaxable;

      rothConversionResult = applyRothConversions({
        conversions: data.rothConversions,
        accounts: workingAccounts,
        accountBalances,
        basisMap,
        rothValueMap,
        accountLedgers,
        year,
        ownerAges: { client: ages.client, spouse: ages.spouse },
        spouseFamilyMemberId: spouseFmId,
        preConversionOrdinaryIncome,
        filingStatus: convFilingStatus,
        ordinaryBrackets: convBrackets,
        taxDeduction: convStdDeduction,
      });
    }

    // 5. Compute taxable income total and per-category tax detail.
    // Declared `let` so the Phase 3 entity-passthrough block can add its
    // passthrough total for flat-mode compatibility (bracket mode reads
    // taxDetail directly; flat mode reads taxableIncome).
    let taxableIncome =
      income.salaries +
      income.business +
      income.deferred +
      income.capitalGains +
      income.trust +
      householdRmdIncome +
      grantorIncome.salaries +
      grantorIncome.business +
      grantorIncome.deferred +
      grantorIncome.capitalGains +
      grantorIncome.trust +
      grantorRmdTaxable +
      realizationOI +
      realizationQDiv +
      realizationSTCG +
      transferResult.taxableOrdinaryIncome +
      transferResult.capitalGains +
      rothConversionResult.taxableOrdinaryIncome +
      saleResult.capitalGains;
    // Build per-year tax detail breakdown. Income items use their taxType when
    // set, otherwise fall back to the legacy type-based mapping.
    const taxDetail: ProjectionYear["taxDetail"] = {
      earnedIncome: 0,
      ordinaryIncome: realizationOI,
      dividends: realizationQDiv,
      capitalGains: 0,
      stCapitalGains: realizationSTCG,
      qbi: 0,
      taxExempt: 0,
      bySource: { ...realizationBySource, ...rmdBySource },
    };
    // Map income entries to tax categories. Social Security is intentionally
    // excluded from this loop: `socialSecurityGross` is passed separately into
    // the bracket engine, which runs `calcTaxableSocialSecurity` against it
    // and adds the taxable portion to `totalIncome`. Adding SS here (as the
    // legacy mapping did, via legacyTaxType("social_security") → ordinary)
    // double-counted it for every retiree in bracket mode.
    for (const inc of currentIncomes) {
      const incGate = itemProrationGate(inc, year, data.client);
      if (!incGate.include) continue;
      if (inc.ownerEntityId != null && !isGrantorEntity(inc.ownerEntityId)) continue;
      if (inc.type === "social_security") continue;
      const inflateFrom = inc.inflationStartYear ?? inc.startYear;
      const amount = inc.annualAmount * Math.pow(1 + inc.growthRate, year - inflateFrom) * incGate.factor;
      const tt = inc.taxType ?? legacyTaxType(inc.type);
      switch (tt) {
        case "earned_income": taxDetail.earnedIncome += amount; break;
        case "ordinary_income": taxDetail.ordinaryIncome += amount; break;
        case "dividends": taxDetail.dividends += amount; break;
        case "capital_gains": taxDetail.capitalGains += amount; break;
        case "stcg": taxDetail.stCapitalGains += amount; break;
        case "qbi": taxDetail.qbi += amount; break;
        case "tax_exempt": taxDetail.taxExempt += amount; break;
      }
      taxDetail.bySource[inc.id] = { type: tt, amount };
    }

    // ── Phase 3: business-entity tax incidence (passthrough K-1) ──────────
    // For each business entity (entityType !== 'trust'), compute net income
    // and flow it to owners' 1040 buckets per the entity's taxTreatment,
    // scaled by each family-member owner's percent. Trusts are skipped —
    // they keep the existing 1041 / grantor pass.
    // Per spec § Phase 3 decisions:
    //   P3-2: qbi → qbi; ordinary → ordinaryIncome; non_taxable → taxExempt
    //   P3-3: skip when entityType === 'trust'
    //   P3-6: ownership gap (sum < 1) → only known shares are taxed
    //   P3-8: losses (net ≤ 0) → no tax incidence
    //
    // Also adds family-owned taxable share to `taxableIncome` so flat-rate mode
    // (which reads taxableIncome, not taxDetail buckets) picks it up correctly.
    // Bracket mode reads taxDetail directly, so both modes are covered.
    for (const entity of currentEntities) {
      if (entity.entityType === "trust") continue;
      // Grantor business entities already flow through the household path
      // (computeIncome's grantor filter + the household-tax loop above include
      // them in taxDetail/taxableIncome). Skipping here prevents double-counting.
      if (entity.isGrantor) continue;
      const netIncome = computeBusinessEntityNetIncome(
        entity.id,
        currentIncomes,
        allExpenses,
        year,
        data.entityFlowOverrides ?? [],
        entity.flowMode ?? "annual",
        data.client,
      );
      if (netIncome <= 0) continue;
      const treatment = entity.taxTreatment ?? "ordinary";
      const familyOwners = entity.owners ?? [];
      let entityFamilyTaxable = 0;
      for (const owner of familyOwners) {
        const taxableShare = netIncome * owner.percent;
        if (taxableShare === 0) continue;
        entityFamilyTaxable += taxableShare;
        switch (treatment) {
          case "qbi":
            taxDetail.qbi += taxableShare;
            break;
          case "ordinary":
            taxDetail.ordinaryIncome += taxableShare;
            break;
          case "non_taxable":
            taxDetail.taxExempt += taxableShare;
            break;
        }
      }
      // Flat-rate mode: add to taxableIncome so calculateTaxYearFlat sees it.
      // Non-taxable treatment is excluded — it should not count as taxable income.
      if (treatment !== "non_taxable") {
        taxableIncome += entityFamilyTaxable;
      }
      // Drilldown: attribute the entity's total taxable amount under one bySource
      // key so reports can identify the source. Owner % split is a 1040 detail
      // not surfaced in bySource.
      const totalTaxable = netIncome * familyOwners.reduce((s, o) => s + o.percent, 0);
      if (totalTaxable !== 0) {
        const bySourceType =
          treatment === "qbi" ? "qbi"
          : treatment === "non_taxable" ? "tax_exempt"
          : "ordinary_income";
        taxDetail.bySource[`entity_passthrough:${entity.id}`] = {
          type: bySourceType,
          amount: totalTaxable,
        };
      }
    }

    // Add RMDs to ordinary income
    if (householdRmdIncome > 0) {
      taxDetail.ordinaryIncome += householdRmdIncome;
    }
    if (grantorRmdTaxable > 0) {
      taxDetail.ordinaryIncome += grantorRmdTaxable;
    }

    // Add transfer and sale income to tax detail
    taxDetail.ordinaryIncome += transferResult.taxableOrdinaryIncome;
    taxDetail.ordinaryIncome += rothConversionResult.taxableOrdinaryIncome;
    taxDetail.capitalGains +=
      transferResult.capitalGains + saleResult.capitalGains + grantorCarryInCapGains;
    if (grantorCarryInCapGains > 0) {
      taxDetail.bySource["entity_gap_fill_prior_year:capital_gains"] = {
        type: "capital_gains",
        amount: grantorCarryInCapGains,
      };
    }

    // Track sources for drill-down
    for (const [tid, info] of Object.entries(transferResult.byTransfer)) {
      if (info.amount > 0) {
        taxDetail.bySource[`transfer:${tid}`] = { type: "ordinary_income", amount: info.amount };
      }
    }
    for (const [cid, info] of Object.entries(rothConversionResult.byConversion)) {
      if (info.taxable > 0) {
        taxDetail.bySource[`roth_conversion:${cid}`] = { type: "ordinary_income", amount: info.taxable };
      }
    }
    for (const item of saleResult.breakdown) {
      if (item.capitalGain > 0) {
        taxDetail.bySource[`sale:${item.transactionId}`] = { type: "capital_gains", amount: item.capitalGain };
      }
    }

    // ── Non-grantor trust annual pass ────────────────────────────────────────
    // Runs after taxDetail is fully assembled. Results feed:
    //   (a) householdIncomeDelta → adjusts taxDetail before bracket calc
    //   (b) trustTaxByEntity / trustWarnings → attached to the ProjectionYear
    //   (c) cash debits for tax + distributions → applied to accountBalances
    let trustPassResult: ReturnType<typeof applyTrustAnnualPass> | null = null;
    if (nonGrantorTrusts.length > 0) {
      // Build AssetTransactionGain[] from sale breakdown, pro-rating each gain
      // by the sold account's ownership at the sale year. Source from the
      // invariant `accountById` (built from `data.accounts` outside the year
      // loop) because the BoY sale step removes sold accounts from
      // `workingAccounts` BEFORE this lookup runs — `workingAccounts` would
      // silently miss every sold trust account.
      // T8: use ownersForYear so gift events that transferred ownership before
      // the sale year are reflected in the cap-gain split (Phase 3).
      const assetTransactionGains: AssetTransactionGain[] = [];
      for (const item of saleResult.breakdown) {
        const sold = accountById.get(item.accountId);
        if (!sold) continue;
        const saleYearOwners = ownersForYear(sold, data.giftEvents, year, planSettings.planStartYear);
        for (const owner of saleYearOwners) {
          if (owner.kind !== "entity") continue;
          if (isGrantorEntity(owner.entityId)) continue;
          assetTransactionGains.push({
            ownerEntityId: owner.entityId,
            gain: item.capitalGain * owner.percent,
          });
        }
      }

      // Step 12c carry-over: prior-year entity gap-fill liquidations of trust
      // taxable accounts surface here so this year's trust-tax pass picks up
      // the recognized gain. (Grantor entries were routed to household above.)
      if (nonGrantorCarryInGains.length > 0) {
        assetTransactionGains.push(...nonGrantorCarryInGains);
      }

      // Trust-owned gains from same-year sales were added to household taxDetail
      // at line ~1124 (full saleResult.capitalGains) and need to be subtracted
      // back out so the bracket engine doesn't tax them twice (trust pays its
      // own 1041 cap-gains tax). Carry-in gains were never added to household
      // taxDetail in the first place, so exclude them from the subtraction.
      const carryInTotal = nonGrantorCarryInGains.reduce((s, g) => s + g.gain, 0);
      const sameYearTrustGains = assetTransactionGains.reduce((s, g) => s + g.gain, 0) - carryInTotal;
      if (sameYearTrustGains > 0) {
        taxDetail.capitalGains = Math.max(0, taxDetail.capitalGains - sameYearTrustGains);
      }

      // Build trustLiquidity from current accountBalances for each trust.
      // Each non-checking account contributes only its trust-owned share —
      // the rest belongs to the household / other entities and isn't tappable
      // for this trust's distributions or tax bill.
      // T9: use year-aware ownedByEntityAtYear so gift events that transferred
      // account ownership to a non-grantor trust are reflected in the trust's
      // tappable liquidity starting the year the gift fires.
      const trustLiquidity = new Map<string, TrustLiquidityPool>();
      for (const trust of nonGrantorTrusts) {
        const checkingId = entityCheckingByEntityId[trust.entityId];
        const cash = checkingId != null ? (accountBalances[checkingId] ?? 0) : 0;
        // Aggregate taxable brokerage balances for this trust
        let taxableBrokerage = 0;
        let retirementInRmdPhase = 0;
        for (const acct of workingAccounts) {
          const trustShare = ownedByEntityAtYear(acct, data.giftEvents, trust.entityId, year, planSettings.planStartYear);
          if (trustShare <= 0) continue;
          if (acct.id === checkingId) continue;
          const balance = accountBalances[acct.id] ?? 0;
          if (acct.category === "taxable") taxableBrokerage += balance * trustShare;
          if (acct.category === "retirement" && acct.rmdEnabled) {
            retirementInRmdPhase += balance * trustShare;
          }
        }
        trustLiquidity.set(trust.entityId, { cash, taxableBrokerage, retirementInRmdPhase });
      }

      // Resolve trust-bracket params — requires tax year data (bracket mode).
      const trustYearParams = taxResolver ? taxResolver.getYear(year) : null;
      const tp = trustYearParams?.params;
      const trustIncomeBrackets = tp?.trustIncomeBrackets ?? [];
      const trustCapGainsBrackets = tp?.trustCapGainsBrackets ?? [];
      const niitRate = tp?.niitRate ?? 0;
      // NIIT threshold for trusts uses the compressed 37% bracket floor per the brief.
      const niitThreshold = trustIncomeBrackets.length >= 4
        ? trustIncomeBrackets[3].from
        : (tp?.niitThreshold?.single ?? 0);

      // §642(c) — for non-grantor split-interest trusts (post-grantor-death
      // CLUTs) we need to feed this year's unitrust payment into the trust-
      // tax pass as a charitable deduction. The unitrust amount is a function
      // of BoY FMV so we can pre-compute it here before the actual emission
      // happens later in the year loop's CLUT annual payment block.
      const nonGrantorTrustsWithDeductions = nonGrantorTrusts.map((t) => {
        const ent = entityMap[t.entityId];
        if (!ent || ent.trustSubType !== "clut" || !ent.splitInterest) return t;
        const si = ent.splitInterest;
        const yearsSinceInception = year - si.inceptionYear;
        if (yearsSinceInception < 0) return t;
        if (
          si.termType === "years" &&
          yearsSinceInception >= (si.termYears ?? 0)
        ) {
          return t;
        }
        let startOfYearFmv = 0;
        for (const acct of workingAccounts) {
          const trustShare = ownedByEntityAtYear(
            acct,
            data.giftEvents,
            ent.id,
            year,
            planSettings.planStartYear,
          );
          if (trustShare <= 0) continue;
          const ledger = accountLedgers[acct.id];
          if (!ledger) continue;
          startOfYearFmv += ledger.beginningValue * trustShare;
        }
        if (startOfYearFmv <= 0) return t;
        const { unitrustAmount } = computeAnnualUnitrustPayment({
          payoutPercent: Number(si.payoutPercent ?? 0),
          startOfYearFmv,
        });
        return unitrustAmount > 0
          ? { ...t, charitableDeduction: unitrustAmount }
          : t;
      });

      trustPassResult = applyTrustAnnualPass({
        year,
        nonGrantorTrusts: nonGrantorTrustsWithDeductions,
        yearRealizations,
        assetTransactionGains,
        trustLiquidity,
        trustIncomeBrackets,
        trustCapGainsBrackets,
        niitRate,
        niitThreshold,
        flatStateRate: planSettings.flatStateRate,
        outOfHouseholdRate: planSettings.outOfHouseholdRate ?? 0.37,
      });

      // Apply household income delta BEFORE the bracket calc sees it.
      taxDetail.ordinaryIncome += trustPassResult.householdIncomeDelta.ordinary;
      taxDetail.dividends += trustPassResult.householdIncomeDelta.dividends;
      taxDetail.taxExempt += trustPassResult.householdIncomeDelta.taxExempt;

      // Apply trust cash debits (distributions drawn from cash + trust tax paid).
      // We deliberately allow checking to go negative here — step 12c (entity
      // gap-fill) runs later in the year and will liquidate the trust's other
      // liquid assets to cover the deficit, emitting `entity_overdraft` if the
      // remaining liquid pool is insufficient. The previous force-zero behavior
      // here would mask deficits that gap-fill could legitimately recover from.
      for (const trust of nonGrantorTrusts) {
        const checkingId = entityCheckingByEntityId[trust.entityId];
        if (!checkingId) continue;
        const dist = trustPassResult.distributionsByEntity.get(trust.entityId);
        const tax = trustPassResult.taxByEntity.get(trust.entityId);
        const debit = (dist?.drawFromCash ?? 0) + (tax?.total ?? 0);
        if (debit <= 0) continue;
        const currentCash = accountBalances[checkingId] ?? 0;
        accountBalances[checkingId] = currentCash - debit;
      }
    }

    // ── Grantor irrevocable trust distribution pass ───────────────────────────
    // For grantor trusts (e.g. IDGT/SLAT), income already flows through the
    // household 1040 via the existing pipeline — no DNI routing, no trust-level
    // tax. This pass handles the optional cash movement: trust checking → household
    // (or out-of-household, which exits the projection).
    // Runs AFTER the non-grantor pass so both passes see consistent year-start
    // accountBalances, and BEFORE the household tax engine.
    const grantorDistributionWarnings: TrustWarning[] = [];
    if (grantorTrusts.length > 0) {
      // Collect asset-transaction gains for grantor entities (needed for
      // pct_income mode), pro-rated by each grantor entity's share of the
      // sold account. Same caveat as the non-grantor lookup above:
      // `workingAccounts` no longer contains sold accounts at this point in
      // the year loop, so we resolve ownership against the invariant
      // `accountById` map.
      for (const item of saleResult.breakdown) {
        const sold = accountById.get(item.accountId);
        if (!sold) continue;
        const grantorSaleYearOwners = ownersForYear(
          sold,
          data.giftEvents,
          year,
          planSettings.planStartYear,
        );
        for (const owner of grantorSaleYearOwners) {
          if (owner.kind !== "entity") continue;
          if (!isGrantorEntity(owner.entityId)) continue;
          const bucket = grantorTrustIncomeByEntity.get(owner.entityId);
          if (bucket) bucket.recognizedCapGains += item.capitalGain * owner.percent;
        }
      }

      for (const gt of grantorTrusts) {
        const checkingId = entityCheckingByEntityId[gt.entityId];
        if (!checkingId) continue; // no checking account — cannot distribute

        const cash = accountBalances[checkingId] ?? 0;
        // Aggregate taxable brokerage for this grantor trust — only the
        // trust-owned share of each fractional-ownership account contributes
        // to its tappable liquidity.
        // T9: use year-aware ownedByEntityAtYear so gift events that transferred
        // account ownership into the grantor trust are reflected in its tappable
        // liquidity starting the year the gift fires.
        let taxableBrokerage = 0;
        let retirementInRmdPhase = 0;
        for (const acct of workingAccounts) {
          const trustShare = ownedByEntityAtYear(acct, data.giftEvents, gt.entityId, year, planSettings.planStartYear);
          if (trustShare <= 0) continue;
          if (acct.id === checkingId) continue;
          const balance = accountBalances[acct.id] ?? 0;
          if (acct.category === "taxable") taxableBrokerage += balance * trustShare;
          if (acct.category === "retirement" && acct.rmdEnabled) {
            retirementInRmdPhase += balance * trustShare;
          }
        }
        const liquid: TrustLiquidityPool = { cash, taxableBrokerage, retirementInRmdPhase };
        const income = grantorTrustIncomeByEntity.get(gt.entityId) ?? {
          ordinary: 0, dividends: 0, taxExempt: 0, recognizedCapGains: 0,
        };

        const dist = computeDistribution({ entityId: gt.entityId, policy: gt.policy, income, liquid });
        grantorDistributionWarnings.push(...dist.warnings);

        if (dist.actualAmount <= 0) continue;

        // Debit from trust checking via creditCash (negative amount) so that
        // the ledger endingValue and cashDelta are updated consistently at step 11.
        // The full actualAmount is drawn from checking (drawFromCash covers what
        // was liquid in cash; drawFromTaxable is approximated as a settlement into
        // checking, consistent with how non-grantor trust liquidations settle).
        creditCash(checkingId, -dist.actualAmount, {
          category: "expense",
          label: `Grantor trust distribution out`,
          sourceId: gt.entityId,
        });

        // Credit to household only when beneficiary is household; otherwise the
        // cash exits the projection (non-household beneficiary lives outside scope).
        if (gt.policy.beneficiaryKind === "household") {
          creditCash(defaultChecking?.id, dist.actualAmount, {
            category: "income",
            label: `Grantor trust distribution`,
            sourceId: gt.entityId,
          });
        }
      }
    }

    // ── CLUT annual unitrust payment pass ─────────────────────────────────
    // Each year of a CLUT's term, the trust pays a fixed % of its BoY FMV
    // to the designated charity. Cash-first via creditCash; if trust checking
    // goes negative, step 12c gap-fill liquidates trust assets and attributes
    // any realized gains to the grantor via the deferred-gain mechanism.
    // Tasks 11-12 add post-grantor-death tax routing (§170(f)(2)(B) recapture
    // and §642(c) deduction); this block handles only the cash-flow.
    let clutCharitableOutflowsTotal = 0;
    const clutCharitableOutflowDetail: Array<{
      kind: "clut_unitrust";
      trustId: string;
      trustName: string;
      charityId: string;
      amount: number;
    }> = [];
    for (const trust of currentEntities) {
      if (trust.trustSubType !== "clut" || !trust.splitInterest) continue;
      const si = trust.splitInterest;
      const yearsSinceInception = year - si.inceptionYear;
      if (yearsSinceInception < 0) continue;
      if (
        si.termType === "years" &&
        yearsSinceInception >= (si.termYears ?? 0)
      ) {
        continue;
      }
      // Life-based termination is handled in Task 10's trust-termination pass.
      const checkingId = entityCheckingByEntityId[trust.id];
      if (!checkingId) continue;

      let startOfYearFmv = 0;
      for (const acct of workingAccounts) {
        const trustShare = ownedByEntityAtYear(
          acct,
          data.giftEvents,
          trust.id,
          year,
          planSettings.planStartYear,
        );
        if (trustShare <= 0) continue;
        const ledger = accountLedgers[acct.id];
        if (!ledger) continue;
        startOfYearFmv += ledger.beginningValue * trustShare;
      }
      if (startOfYearFmv <= 0) continue;

      const { unitrustAmount } = computeAnnualUnitrustPayment({
        payoutPercent: Number(si.payoutPercent ?? 0),
        startOfYearFmv,
      });
      if (unitrustAmount <= 0) continue;

      creditCash(checkingId, -unitrustAmount, {
        category: "gift",
        label: `CLUT unitrust payment to charity`,
        sourceId: trust.id,
      });
      clutCharitableOutflowsTotal += unitrustAmount;
      clutCharitableOutflowDetail.push({
        kind: "clut_unitrust",
        trustId: trust.id,
        trustName: trust.name ?? trust.id,
        charityId: si.charityId,
        amount: unitrustAmount,
      });

      // Record the payment for cross-year recapture math. The death-year
      // payment IS counted in the PV per §170(f)(2)(B), so this push happens
      // before the recapture pass below for this same year.
      const existing = clutPaymentsByTrustId.get(trust.id) ?? [];
      existing.push(unitrustAmount);
      clutPaymentsByTrustId.set(trust.id, existing);
    }

    // ── CLUT trust-termination pass ───────────────────────────────────────
    // The year after a CLUT's lead term ends, remaining trust assets are
    // distributed to the trust's primary remainder beneficiaries. Cash leaves
    // the trust via creditCash; a TrustTerminationResult is recorded on the
    // year row for downstream report consumers (Task 13+ surfaces them).
    // Asset routing to specific beneficiary accounts is intentionally not
    // implemented here — the cash exits the projection scope at termination,
    // mirroring how non-household charity outflows are handled. Future tasks
    // may refine to per-beneficiary deposit if the user adds beneficiary-owned
    // accounts to the data model.
    const yearTrustTerminations: TrustTerminationResult[] = [];
    for (const trust of currentEntities) {
      if (trust.trustSubType !== "clut" || !trust.splitInterest) continue;
      // Death-year extraction for life-based termination is deferred to
      // Tasks 11-12 when the death-event integration lands; until then,
      // term-certain ('years') CLUTs are the only ones that terminate here.
      if (!isTrustTerminationYear(trust, year, {})) continue;

      let totalAvailable = 0;
      for (const acct of workingAccounts) {
        const trustShare = ownedByEntityAtYear(
          acct,
          data.giftEvents,
          trust.id,
          year,
          planSettings.planStartYear,
        );
        if (trustShare <= 0) continue;
        const balance = accountBalances[acct.id] ?? 0;
        totalAvailable += balance * trustShare;
      }
      if (totalAvailable <= 0) continue;

      const result = distributeAtTermination(
        {
          trust,
          currentYear: year,
          designations: trust.beneficiaries ?? [],
        },
        totalAvailable,
      );
      yearTrustTerminations.push(result);

      // Drain the trust's accounts pro-rata (cash exits the projection scope
      // at the termination event — see comment above).
      for (const acct of workingAccounts) {
        const trustShare = ownedByEntityAtYear(
          acct,
          data.giftEvents,
          trust.id,
          year,
          planSettings.planStartYear,
        );
        if (trustShare <= 0) continue;
        const balance = accountBalances[acct.id] ?? 0;
        const drain = balance * trustShare;
        if (drain <= 0) continue;
        creditCash(acct.id, -drain, {
          category: "expense",
          label: `CLUT termination distribution`,
          sourceId: trust.id,
        });
      }
    }

    // ── §170(f)(2)(B) recapture pass ──────────────────────────────────────
    // When a grantor of a CLUT dies before the lead term ends, the unused
    // portion of the original income-interest deduction is recaptured as
    // ordinary income on the grantor's final 1040. Recapture =
    //   originalIncomeInterest − PV(actual payments) at the original §7520 rate.
    // Floored at 0; only fires for term-certain ('years' or
    // 'shorter_of_years_or_life') CLUTs — for pure life CLUTs the death IS
    // the term-end and there's no recapture.
    const decedentRoleThisYear: "client" | "spouse" | null =
      year === firstDeathYear
        ? firstDeathDeceased
        : year === finalDeathYear
          ? finalDeceased
          : null;
    if (decedentRoleThisYear != null) {
      for (const trust of currentEntities) {
        if (trust.trustSubType !== "clut" || !trust.splitInterest) continue;
        if (trust.grantor !== decedentRoleThisYear) continue;
        const si = trust.splitInterest;
        const isYearsLeg =
          si.termType === "years" ||
          si.termType === "shorter_of_years_or_life";
        if (!isYearsLeg) continue;
        const yearsElapsed = year - si.inceptionYear + 1;
        if (yearsElapsed >= (si.termYears ?? 0)) continue;
        const payments = clutPaymentsByTrustId.get(trust.id) ?? [];
        const { recaptureAmount } = computeClutRecapture({
          originalIncomeInterest: Number(si.originalIncomeInterest),
          irc7520Rate: Number(si.irc7520Rate),
          paymentsByYearOffset: payments,
        });
        if (recaptureAmount > 0) {
          taxDetail.ordinaryIncome += recaptureAmount;
          taxDetail.bySource[`clut_recapture:${trust.id}`] = {
            type: "ordinary_income",
            amount: recaptureAmount,
          };
        }
      }
    }

    // 5. Taxes on household + grantor-trust income/RMDs. Routes to bracket or flat
    // engine depending on planSettings.taxEngineMode and whether tax year data is loaded.
    const resolved = taxResolver ? taxResolver.getYear(year) : null;
    const filingStatus = effectiveFilingStatus(
      (client.filingStatus ?? "single") as FilingStatus,
      firstDeathYear,
      year,
    );
    const useBracket = planSettings.taxEngineMode === "bracket" && resolved != null;

    // Pre-compute salary-by-owner and salary-by-rule-id so both the deduction
    // derivation and the employer-match + percent-mode employee contribution
    // paths resolve against the same per-owner salary. Filters to personal
    // (non-entity) salary income within the year range.
    const salaryByOwner: Record<"client" | "spouse" | "joint", number> = {
      client: 0,
      spouse: 0,
      joint: 0,
    };
    // Salary base for contribution rules and employer match: use the FULL
    // annual salary (NOT prorated for retirement month). Contribution rules
    // expressed as "10% of salary" are evaluated on full-year salary; the
    // proration to the partial retirement year is applied inside
    // applySavingsRules via itemProrationGate, so re-applying it here would
    // double-discount. The tax-side salary number (`income.salaries`) IS
    // prorated — that comes from computeIncome and is used for tax/cashflow.
    for (const inc of currentIncomes) {
      if (inc.type !== "salary") continue;
      if (inc.ownerEntityId != null) continue;
      const salaryGate = itemProrationGate(inc, year, data.client);
      if (!salaryGate.include) continue;
      const inflateFrom = inc.inflationStartYear ?? inc.startYear;
      const amount = inc.annualAmount * Math.pow(1 + inc.growthRate, year - inflateFrom);
      salaryByOwner[inc.owner] += amount;
    }
    const totalHouseholdSalary =
      salaryByOwner.client + salaryByOwner.spouse + salaryByOwner.joint;
    // `accountById` is declared once at function scope above the year loop.
    const salaryByRuleId: Record<string, number> = {};
    for (const rule of data.savingsRules) {
      const acct = accountById.get(rule.accountId);
      if (acct) {
        const cfm = controllingFamilyMember(acct);
        if (cfm === spouseFmId && spouseFmId != null) {
          salaryByRuleId[rule.id] = salaryByOwner.spouse;
        } else if (cfm === clientFmId && clientFmId != null) {
          salaryByRuleId[rule.id] = salaryByOwner.client;
        } else if (cfm == null && (clientFmId != null || spouseFmId != null)) {
          // Joint (multiple FM owners) or entity-owned: no individual salary can ground
          // an employer match. Return 0 so the match is suppressed. Only applies when
          // we have proper FM resolution (clientFmId / spouseFmId set); legacy plans
          // without FMs fall through to household total (backward-compatible).
          salaryByRuleId[rule.id] = 0;
        } else {
          salaryByRuleId[rule.id] = totalHouseholdSalary;
        }
      } else {
        salaryByRuleId[rule.id] = totalHouseholdSalary;
      }
    }

    // Resolve each rule's pre-cap dollar contribution so we can apply IRS
    // contribution limits in one place. Respects scheduleOverrides first,
    // then contributeMax (IRS limit), then percent-mode vs annualAmount.
    // Rules outside their year range are left out entirely (keys absent).
    const resolvedByRuleId: Record<string, number> = {};
    for (const rule of data.savingsRules) {
      // Inclusion only — DO NOT multiply by gate.factor here. The pre-cap
      // resolution feeds into applyContributionLimits + applySavingsRules,
      // and proration is applied at the application step. Including a rule
      // with a partial retirement year here keeps it eligible for the cap
      // logic; the eventual contribution gets prorated in applySavingsRules.
      if (!itemProrationGate(rule, year, data.client).include) continue;
      const override = rule.scheduleOverrides?.[year];
      if (override != null) {
        resolvedByRuleId[rule.id] = override;
        continue;
      }
      if (rule.contributeMax && resolved) {
        const acct = accountById.get(rule.accountId);
        if (acct) {
          const ownerDob =
            isSpouseAccount(acct) ? client.spouseDob : client.dateOfBirth;
          const age = resolveAgeInYear(ownerDob, year);
          resolvedByRuleId[rule.id] = computeMaxContribution(
            acct.subType ?? "",
            resolved.params,
            age
          );
          continue;
        }
      }
      const salary = salaryByRuleId[rule.id] ?? 0;
      resolvedByRuleId[rule.id] = resolveContributionAmount(rule, salary);
    }

    // Apply IRS 401k/403b and IRA contribution limits (aggregated per owner).
    // Rules with applyContributionLimit === false bypass the cap.
    const capResult = resolved
      ? applyContributionLimits({
          year,
          rules: data.savingsRules,
          accounts: data.accounts,
          client,
          taxYearParams: resolved.params,
          resolvedByRuleId,
          familyMembers: data.familyMembers ?? [],
        })
      : { cappedByRuleId: resolvedByRuleId, adjustments: [] };
    const cappedByRuleId = capResult.cappedByRuleId;

    let aboveLineDeductions = 0;
    let itemizedDeductions = 0;
    let deductionBreakdownResult: DeductionBreakdown | undefined;
    if (useBracket) {
      const contributions = [
        deriveAboveLineFromSavings(
          year,
          data.savingsRules.map((r) => ({
            id: r.id,
            accountId: r.accountId,
            annualAmount: r.annualAmount,
            annualPercent: r.annualPercent ?? null,
            isDeductible: r.isDeductible,
            startYear: r.startYear,
            endYear: r.endYear,
          })),
          data.accounts.map((a) => ({
            id: a.id,
            subType: a.subType ?? "",
            category: a.category,
            ownerEntityId: controllingEntity(a) ?? undefined,
          })),
          isGrantorEntity,
          salaryByRuleId,
          cappedByRuleId
        ),
        deriveAboveLineFromExpenses(year, allExpenses.map((e) => ({
          deductionType: e.deductionType ?? null,
          annualAmount: e.annualAmount,
          startYear: e.startYear,
          endYear: e.endYear,
          growthRate: e.growthRate,
          inflationStartYear: e.inflationStartYear,
        }))),
        deriveItemizedFromExpenses(year, allExpenses.map((e) => ({
          deductionType: e.deductionType ?? null,
          annualAmount: e.annualAmount,
          startYear: e.startYear,
          endYear: e.endYear,
          growthRate: e.growthRate,
          inflationStartYear: e.inflationStartYear,
        }))),
        deriveMortgageInterestFromLiabilities(
          year,
          currentLiabilities.map((l) => ({
            id: l.id,
            isInterestDeductible: l.isInterestDeductible ?? false,
            startYear: l.startYear,
            endYear: l.startYear + Math.ceil(l.termMonths / 12) - 1,
          })),
          // Only the household share of mortgage interest counts toward the
          // household 1040 itemized deduction.
          // T9: year-aware helper so gift events that transferred liability
          // ownership to an entity reduce the household mortgage-interest deduction
          // starting the year the gift fires.
          Object.fromEntries(
            currentLiabilities.map((l) => [
              l.id,
              (liabResult.interestByLiability[l.id] ?? 0) * liabilityOwnedByHouseholdAtYear(l, data.giftEvents, year, planSettings.planStartYear),
            ])
          )
        ),
        derivePropertyTaxFromAccounts(
          year,
          workingAccounts.map((a) => ({
            id: a.id,
            name: a.name,
            category: a.category,
            // Only the household share of property tax counts toward SALT.
            // Entity-owned shares are paid by the entity and don't show on
            // the household 1040 deduction.
            // T9: year-aware helper so gift events that transferred real-estate
            // ownership to an entity reduce the household SALT deduction.
            annualPropertyTax: (a.annualPropertyTax ?? 0) * ownedByHouseholdAtYear(a, data.giftEvents, year, planSettings.planStartYear),
            propertyTaxGrowthRate: a.propertyTaxGrowthRate ?? 0.03,
          })),
          planSettings.planStartYear
        ),
        sumItemizedFromEntries(year, data.deductions ?? []),
      ];
      // Estimate state income tax for SALT pool before aggregation.
      const preAGI = Math.max(0, taxableIncome - contributions[0].aboveLine - contributions[1].aboveLine - contributions[5].aboveLine);
      const estStateTax = preAGI * planSettings.flatStateRate;
      const stateIncomeTaxContribution: import("../lib/tax/derive-deductions").DeductionContribution = {
        aboveLine: 0,
        itemized: 0,
        saltPool: estStateTax,
      };
      const agg = aggregateDeductions(year, ...contributions, stateIncomeTaxContribution);
      aboveLineDeductions = agg.aboveLine;
      itemizedDeductions = agg.itemized;

      // Assemble per-source breakdown for drill-down UI.
      const retirementContributions = contributions[0].aboveLine;
      const expenseAboveLine = contributions[1].aboveLine;
      const manualAboveLine = contributions[5].aboveLine;

      // Below-line per-category split from source data
      let charitable = 0;
      let otherItemized = 0;
      const belowLineBySource: Record<string, { label: string; amount: number }> = {};

      for (const exp of allExpenses) {
        if (!exp.deductionType || exp.deductionType === "above_line" || exp.deductionType === "property_tax") continue;
        const expGate = itemProrationGate(exp, year, data.client);
        if (!expGate.include) continue;
        const inflateFrom = exp.inflationStartYear ?? exp.startYear;
        const amount = exp.annualAmount * Math.pow(1 + exp.growthRate, year - inflateFrom) * expGate.factor;
        if (exp.deductionType === "charitable") {
          charitable += amount;
          belowLineBySource[exp.id] = { label: `Expense: ${exp.name}`, amount };
        } else {
          otherItemized += amount;
          belowLineBySource[exp.id] = { label: `Expense: ${exp.name}`, amount };
        }
      }

      for (const row of data.deductions ?? []) {
        if (year < row.startYear || year > row.endYear) continue;
        const yearsSinceStart = year - row.startYear;
        const inflated = row.annualAmount * Math.pow(1 + row.growthRate, yearsSinceStart);
        if (row.type === "charitable") {
          charitable += inflated;
        } else if (row.type === "below_line") {
          otherItemized += inflated;
        }
      }

      const interestPaid = contributions[3].itemized;
      const rawPropertyTax = contributions[2].saltPool + contributions[4].saltPool + contributions[5].saltPool;
      // estStateTax already computed above for aggregateDeductions
      const rawSalt = rawPropertyTax + estStateTax;
      const taxesPaid = Math.min(rawSalt, saltCap(year));
      const itemizedTotal = charitable + taxesPaid + interestPaid + otherItemized;

      const aboveLineBySource: Record<string, { label: string; amount: number }> = {};
      for (const rule of data.savingsRules) {
        const ruleGate = itemProrationGate(rule, year, data.client);
        if (!ruleGate.include) continue;
        const acct = data.accounts.find((a) => a.id === rule.accountId);
        if (!acct) continue;
        const subType = acct.subType ?? "";
        if (subType !== "traditional_ira" && subType !== "401k") continue;
        if (controllingEntity(acct) != null && !isGrantorEntity(controllingEntity(acct)!)) continue;
        aboveLineBySource[rule.id] = { label: acct.name, amount: rule.annualAmount * ruleGate.factor };
      }

      const stdDed = resolved!.params.stdDeduction[filingStatus];
      deductionBreakdownResult = {
        aboveLine: {
          retirementContributions,
          taggedExpenses: expenseAboveLine,
          manualEntries: manualAboveLine,
          total: aboveLineDeductions,
          bySource: aboveLineBySource,
        },
        belowLine: {
          charitable,
          taxesPaid,
          stateIncomeTax: estStateTax,
          propertyTaxes: rawPropertyTax,
          interestPaid,
          otherItemized,
          itemizedTotal,
          standardDeduction: stdDed,
          taxDeductions: Math.max(itemizedTotal, stdDed),
          bySource: belowLineBySource,
        },
      };
    }

    // Sum self-employment earnings for SECA. Applies each income's own
    // growth/schedule treatment (same way computeIncome does), so the SE
    // number lines up with what the advisor sees as household business
    // income. Only personal (non-entity) SE flows are taxed at the
    // household level here.
    let seEarnings = 0;
    for (const inc of currentIncomes) {
      if (!inc.isSelfEmployment) continue;
      const seGate = itemProrationGate(inc, year, data.client);
      if (!seGate.include) continue;
      if (inc.ownerEntityId != null && !isGrantorEntity(inc.ownerEntityId)) continue;
      let amount: number;
      if (inc.ownerEntityId != null) {
        // Phase 2: grantor-entity SE income uses entity overrides.
        // Per-cell overrides bypass retirement-month proration (the override
        // grid is authoritative); the no-override growth-mode fallback IS
        // prorated — passing `data.client` enables that inside
        // resolveEntityFlowAmount.
        amount = resolveEntityFlowAmount(
          inc,
          inc.ownerEntityId,
          "income",
          year,
          data.entityFlowOverrides ?? [],
          entityMap[inc.ownerEntityId]?.flowMode ?? "annual",
          data.client,
        );
      } else if (inc.scheduleOverrides) {
        amount = inc.scheduleOverrides[year] ?? 0;
      } else {
        const inflateFrom = inc.inflationStartYear ?? inc.startYear;
        amount = inc.annualAmount * Math.pow(1 + inc.growthRate, year - inflateFrom) * seGate.factor;
      }
      seEarnings += amount;
    }
    const secaResult = useBracket && resolved
      ? calcSeca({
          seEarnings,
          ssTaxRate: resolved.params.ssTaxRate,
          ssWageBase: resolved.params.ssWageBase,
          medicareTaxRate: resolved.params.medicareTaxRate,
          ficaSsWages: taxDetail.earnedIncome,
        })
      : { seTax: 0, deductibleHalf: 0 };
    // Plan 3a — collect external-charity gifts so the tax helper can apply IRC §170(b)
    // AGI limits + decay + FIFO carryforward consumption. Bucket cash gifts as
    // public/private; v1 simplification: gift events carry no asset-class metadata yet.
    const charityGiftsThisYear: { amount: number; bucket: CharityBucket }[] = [];
    for (const g of data.gifts ?? []) {
      if (g.year !== year) continue;
      if (!g.recipientExternalBeneficiaryId) continue;
      const beneficiary = (data.externalBeneficiaries ?? []).find(
        (eb) => eb.id === g.recipientExternalBeneficiaryId,
      );
      if (!beneficiary || beneficiary.kind !== "charity") continue;
      const isPrivate = beneficiary.charityType === "private";
      charityGiftsThisYear.push({
        amount: g.amount,
        bucket: isPrivate ? "cashPrivate" : "cashPublic",
      });
    }

    // Plan 4d-2 — CLUT inception charitable deduction. The grantor takes the
    // present value of the lead interest as a "for the use of" charitable
    // contribution in the funding year (IRC §170(f)(2)(B)). AGI cap is 30%
    // (public charity) or 20% (private foundation), routed through the
    // appreciated buckets which encode those caps.
    for (const e of data.entities ?? []) {
      if (e.trustSubType !== "clut" || !e.splitInterest) continue;
      if (e.splitInterest.inceptionYear !== year) continue;
      const charity = (data.externalBeneficiaries ?? []).find(
        (eb) => eb.id === e.splitInterest!.charityId,
      );
      if (!charity || charity.kind !== "charity") continue;
      const isPrivate = charity.charityType === "private";
      charityGiftsThisYear.push({
        amount: e.splitInterest.originalIncomeInterest,
        bucket: isPrivate ? "appreciatedPrivate" : "appreciatedPublic",
      });
    }

    // Split realization OI out of the generic ordinaryIncome bucket so NIIT
    // (IRC §1411) can see investment interest while still excluding RMDs,
    // IRA distributions, and SE earnings which ride in ordinaryIncome.
    const interestIncomeForTax = realizationOI;

    const taxOut = computeTaxForYear({
      taxDetail,
      socialSecurityGross: income.socialSecurity,
      totalIncome: income.total,
      taxableIncome,
      filingStatus,
      year,
      planSettings,
      resolved: resolved ?? null,
      useBracket,
      aboveLineDeductions,
      itemizedDeductions,
      charityCarryforwardIn: charityCarryforward,
      charityGiftsThisYear,
      secaResult,
      transferEarlyWithdrawalPenalty: transferResult.earlyWithdrawalPenalty,
      interestIncomeForTax,
      deductionBreakdownIn: deductionBreakdownResult ?? null,
    });

    // `taxes` is the pre-supplemental tax. The legacy no-checking path (else branch
    // in phase 12 below) uses it directly; the hasChecking path runs the convergence
    // loop and ends up with `finalTaxes` from `taxOutForIter` instead.
    const taxes = taxOut.taxes;
    // `charityCarryforward` and `deductionBreakdownResult` are reassigned AFTER the
    // convergence loop (phase 12 below) so iteration restarts each time from the
    // pre-this-year carryforward / breakdown values.

    // 6. Route each income to its cash account (override or default for owner).
    // Prefer the per-source amount already resolved by `computeIncome` — that
    // handles pia_at_fra (orchestrator), schedule overrides, spousal / survivor
    // logic, and the no_benefit / deceased-spouse suppressions. Falling back
    // to `annualAmount × growth^N` here would re-derive SS with legacy rules
    // and credit a different number than `income.socialSecurity` shows (and
    // than `socialSecurityGross` fed into the tax calc), producing three
    // different SS numbers per row.
    for (const inc of currentIncomes) {
      const incRouteGate = itemProrationGate(inc, year, data.client);
      if (!incRouteGate.include) continue;
      // Schedule-mode entities are handled in a dedicated loop below — the
      // schedule grid is the source of truth, so base income rows are not
      // routed here (would double-count or, worse, miss override-only cells
      // when no base row exists).
      if (
        inc.ownerEntityId != null &&
        entityMap[inc.ownerEntityId]?.flowMode === "schedule"
      ) {
        continue;
      }
      const resolved = income.bySource[inc.id] ?? grantorIncome.bySource[inc.id];
      let amount: number;
      if (resolved != null) {
        // computeIncome (or its grantor-flow analogue) has already applied
        // proration via itemProrationGate, so do NOT multiply by gate.factor
        // again here.
        amount = resolved;
      } else {
        // Non-grantor entity incomes (and anything else computeIncome filtered
        // out): apply the same claimingAge gate and legacy growth compounding
        // the previous implementation used.
        if (inc.type === "social_security" && inc.claimingAge != null) {
          const ownerDob = inc.owner === "spouse" ? client.spouseDob : client.dateOfBirth;
          if (!ownerDob) continue;
          const birthYear = parseInt(ownerDob.slice(0, 4), 10);
          if (year < birthYear + inc.claimingAge) continue;
        }
        const inflateFrom = inc.inflationStartYear ?? inc.startYear;
        amount = inc.annualAmount * Math.pow(1 + inc.growthRate, year - inflateFrom) * incRouteGate.factor;
      }
      // Phase 2: for entity-owned rows, apply year-overrides (P2-3 — overrides
      // win over base+growth; per-row scheduleOverrides on entity rows is no
      // longer consulted). Passing `data.client` so the no-override
      // growth-mode fallback is retirement-month-prorated.
      if (inc.ownerEntityId != null) {
        amount = resolveEntityFlowAmount(
          inc,
          inc.ownerEntityId,
          "income",
          year,
          data.entityFlowOverrides ?? [],
          entityMap[inc.ownerEntityId]?.flowMode ?? "annual",
          data.client,
        );
      }
      creditCash(resolveCashAccount(inc.ownerEntityId, inc.cashAccountId), amount, {
        category: "income",
        label: `Income: ${inc.name}`,
        sourceId: inc.id,
      });
    }

    // 7. Route each expense as an outflow from its cash account.
    for (const exp of allExpenses) {
      const expRouteGate = itemProrationGate(exp, year, data.client);
      if (!expRouteGate.include) continue;
      // Schedule-mode entities are handled below.
      if (
        exp.ownerEntityId != null &&
        entityMap[exp.ownerEntityId]?.flowMode === "schedule"
      ) {
        continue;
      }
      const inflateFrom = exp.inflationStartYear ?? exp.startYear;
      let amount = exp.annualAmount * Math.pow(1 + exp.growthRate, year - inflateFrom) * expRouteGate.factor;
      // Phase 2: for entity-owned rows, apply year-overrides.
      // `data.client` enables retirement-month proration on the no-override
      // growth-mode fallback inside resolveEntityFlowAmount.
      if (exp.ownerEntityId != null) {
        amount = resolveEntityFlowAmount(
          exp,
          exp.ownerEntityId,
          "expense",
          year,
          data.entityFlowOverrides ?? [],
          entityMap[exp.ownerEntityId]?.flowMode ?? "annual",
          data.client,
        );
      }
      creditCash(resolveCashAccount(exp.ownerEntityId, exp.cashAccountId), -amount, {
        category: "expense",
        label: `Expense: ${exp.name}`,
        sourceId: exp.id,
      });
    }

    // 7b. Schedule-mode entities: route the (entityId, year) override row's
    // incomeAmount and expenseAmount scalars to the entity's checking. The
    // schedule grid is the authoritative source — base rows (if any) are
    // ignored for schedule-mode entities. This keeps the projection in sync
    // with the entity-cashflow report and lets users populate the grid
    // without first creating placeholder base income/expense rows.
    for (const entity of currentEntities) {
      if (entity.flowMode !== "schedule") continue;
      if (entity.entityType === "trust") continue;
      const ovr = (data.entityFlowOverrides ?? []).find(
        (o) => o.entityId === entity.id && o.year === year,
      );
      if (!ovr) continue;
      const cashAccountId = resolveCashAccount(entity.id);
      if (ovr.incomeAmount != null && ovr.incomeAmount !== 0) {
        creditCash(cashAccountId, ovr.incomeAmount, {
          category: "income",
          label: `Income: ${entity.name ?? "Entity"} (schedule)`,
          sourceId: `entity_schedule_income:${entity.id}`,
        });
      }
      if (ovr.expenseAmount != null && ovr.expenseAmount !== 0) {
        creditCash(cashAccountId, -ovr.expenseAmount, {
          category: "expense",
          label: `Expense: ${entity.name ?? "Entity"} (schedule)`,
          sourceId: `entity_schedule_expense:${entity.id}`,
        });
      }
    }

    // ── Phase 3: business-entity distribution to household ─────────────────
    // After income/expense crediting on entity checking, sweep net income to
    // household checking per the entity's distributionPolicyPercent. Trusts
    // skipped (they keep the existing distribution-policy mechanic).
    //
    // Grantor businesses are included: tax pass-through (handled separately
    // via grantorIncome → household taxableIncome) is orthogonal to cash
    // pass-through. Without this, cash earned by a grantor entity would
    // strand in entity checking forever even when the user sets a 100%
    // distribution policy.
    //
    // Per spec § Phase 3 decisions:
    //   P3-3: skip when entityType === 'trust'
    //   P3-4: same year, audit category "entity_distribution"
    //   P3-5: null distributionPolicyPercent defaults to 1.0
    //   P3-7: target is household defaultChecking always
    //   P3-8: losses → no distribution (skip net ≤ 0)
    for (const entity of currentEntities) {
      if (entity.entityType === "trust") continue;
      const netIncome = computeBusinessEntityNetIncome(
        entity.id,
        currentIncomes,
        allExpenses,
        year,
        data.entityFlowOverrides ?? [],
        entity.flowMode ?? "annual",
        data.client,
      );
      if (netIncome <= 0) continue;
      const distPercent = resolveDistributionPercent(
        entity,
        year,
        data.entityFlowOverrides ?? [],
      );
      const distAmount = netIncome * distPercent;
      if (distAmount === 0) continue;
      const entityCheckingId = entityCheckingByEntityId[entity.id];
      if (!entityCheckingId) continue; // entity has no cash account → cannot distribute
      // Destination: primary owner's default cash account. Falls back to the
      // household defaultChecking when the entity has no defined owners or the
      // owner has no associated cash account. Previously this always credited
      // defaultChecking, which could route the cash to the wrong account (or
      // nowhere) when the grantor's actual cash lived in an account that wasn't
      // the first .find(isDefaultChecking) match.
      const primaryOwner = (entity.owners ?? [])
        .slice()
        .sort((x, y) => y.percent - x.percent)[0];
      const destinationId =
        (primaryOwner ? resolveFamilyMemberDefaultCash(primaryOwner.familyMemberId) : undefined)
        ?? defaultChecking?.id;
      // Debit entity checking
      creditCash(entityCheckingId, -distAmount, {
        category: "entity_distribution",
        label: `Distribution from ${entity.name ?? entity.id}`,
        sourceId: entity.id,
      });
      // Credit owner's default cash account
      creditCash(destinationId, distAmount, {
        category: "entity_distribution",
        label: `Distribution from ${entity.name ?? entity.id}`,
        sourceId: entity.id,
      });
    }

    // 8. Liability payments settle against the owning party's cash account —
    // pro-rated by ownership share. Household share leaves household checking;
    // each entity owner's share leaves that entity's checking.
    // T9: use year-aware liabilityOwnersForYear so gift events that transferred
    // liability ownership to an entity route debt service to the entity's checking
    // starting the year the gift fires.
    for (const liab of data.liabilities) {
      const payment = liabResult.byLiability[liab.id] ?? 0;
      if (payment === 0) continue;
      const liabYearOwners = liabilityOwnersForYear(liab, data.giftEvents, year, planSettings.planStartYear);
      const householdShare = liabYearOwners
        .filter((o) => o.kind === "family_member")
        .reduce((s, o) => s + o.percent, 0);
      if (householdShare > 0) {
        creditCash(resolveCashAccount(undefined), -payment * householdShare, {
          category: "liability",
          label: `Liability: ${liab.name}`,
          sourceId: liab.id,
        });
      }
      for (const owner of liabYearOwners) {
        if (owner.kind !== "entity") continue;
        if (owner.percent <= 0) continue;
        creditCash(resolveCashAccount(owner.entityId), -payment * owner.percent, {
          category: "liability",
          label: `Liability: ${liab.name}`,
          sourceId: liab.id,
        });
      }
    }

    // 9. Tax expense application is deferred to phase 11b (after the cash-delta apply
    // loop) so the iterative convergence loop in Task 11 can capture a pre-tax
    // `preSupplementalChecking` baseline. See phase 11b below.

    // 10. Savings contributions — with a default checking account, savings apply at the
    // full rule amount (cash leaves checking). Without one, fall back to the legacy
    // surplus cap so behaviour matches the pre-migration engine.
    const householdInflows = income.total + householdRmdIncome;
    const householdNonSavingsOutflows =
      expenseBreakdown.living +
      expenseBreakdown.other +
      expenseBreakdown.insurance +
      liabResult.totalPayment +
      taxes;
    const surplusBeforeSavings = householdInflows - householdNonSavingsOutflows;

    const savings = hasChecking
      ? applySavingsRules(
          data.savingsRules,
          year,
          income.salaries,
          data.client,
          undefined,
          salaryByRuleId,
          cappedByRuleId
        )
      : applySavingsRules(
          data.savingsRules,
          year,
          income.salaries,
          data.client,
          Math.max(0, surplusBeforeSavings),
          salaryByRuleId,
          cappedByRuleId
        );

    // Credit employee contributions to destination accounts and debit household checking.
    for (const [acctId, amount] of Object.entries(savings.byAccount)) {
      if (amount === 0) continue;
      accountBalances[acctId] = (accountBalances[acctId] ?? 0) + amount;
      if (accountLedgers[acctId]) {
        accountLedgers[acctId].contributions += amount;
        accountLedgers[acctId].endingValue += amount;
        const destName = data.accounts.find((a) => a.id === acctId)?.name ?? "account";
        accountLedgers[acctId].entries.push({
          category: "savings_contribution",
          label: `Contribution to ${destName}`,
          amount,
          sourceId: acctId,
        });
      }
    }
    creditCash(defaultChecking?.id, -savings.total, {
      category: "savings_contribution",
      label: "Savings contributions",
    });

    // Employer match — direct credit to the destination account, free cash from the
    // employer. Does not touch household checking. Unlike employee contributions,
    // the match must be computed against *only* the account owner's salary — a
    // spouse's salary can't ground the other spouse's 401k match. Joint-owned or
    // orphaned-rule accounts get no match (no individual salary to base it on).
    for (const rule of data.savingsRules) {
      const matchGate = itemProrationGate(rule, year, data.client);
      if (!matchGate.include) continue;
      const acct = data.accounts.find((a) => a.id === rule.accountId);
      const ownerSalary = acct ? (salaryByRuleId[rule.id] ?? 0) : 0;
      // salaryByRuleId carries unprorated full-year salary, so a percentage
      // match comes back at the full annual level. Apply gate.factor here to
      // shrink it to the partial retirement year. (Flat-amount matches use
      // rule.employerMatchAmount and need the same treatment.)
      const match = computeEmployerMatch(rule, ownerSalary) * matchGate.factor;
      if (match === 0) continue;
      accountBalances[rule.accountId] = (accountBalances[rule.accountId] ?? 0) + match;
      if (accountLedgers[rule.accountId]) {
        accountLedgers[rule.accountId].contributions += match;
        accountLedgers[rule.accountId].endingValue += match;
        let label: string;
        if (rule.employerMatchAmount != null && rule.employerMatchAmount > 0) {
          label = "Employer match (flat annual)";
        } else if (rule.employerMatchCap != null) {
          label = `Employer match (${(rule.employerMatchPct! * 100).toFixed(0)}% on ${(rule.employerMatchCap * 100).toFixed(1)}% of salary)`;
        } else {
          label = `Employer match (${(rule.employerMatchPct! * 100).toFixed(2)}% of salary)`;
        }
        accountLedgers[rule.accountId].entries.push({
          category: "employer_match",
          label,
          amount: match,
        });
      }
    }

    // 10b. Cash gifts — one-time gifts and fanned-out series occurrences that fire
    // this year.  Debit the source account (household default checking, or the
    // advisor-specified override) and credit the recipient trust's default checking.
    // Inserted after savings/employer-match so the household shortfall (if any) is
    // visible to the withdrawal gap-fill in step 12.
    let householdCashGiftsTotal = 0;
    for (const gift of data.giftEvents) {
      if (gift.kind !== "cash" || gift.year !== year) continue;
      // Resolve source: use the advisor-specified account if set; fall back to
      // household default checking.  If neither resolves, skip (no crash).
      const sourceId = gift.sourceAccountId ?? defaultChecking?.id;
      if (!sourceId) continue;

      // Resolve recipient: trust's default checking.  If the trust has no
      // default-checking account configured, log a soft skip — don't crash.
      const recipientId = entityCheckingByEntityId[gift.recipientEntityId];
      if (!recipientId) continue;

      creditCash(sourceId, -gift.amount, {
        category: "gift",
        label: `Cash gift to ${currentEntities.find((e) => e.id === gift.recipientEntityId)?.name ?? gift.recipientEntityId}`,
        sourceId: gift.recipientEntityId,
      });
      creditCash(recipientId, gift.amount, {
        category: "gift",
        label: `Cash gift received`,
        sourceId: gift.recipientEntityId,
      });

      // Surface household-side outflows on the cashflow report. Counted only
      // when the source is a household-owned account; gifts originating from
      // entity-owned accounts (e.g. trust → charity) drain the entity, not the
      // household portfolio.
      const sourceAccount = data.accounts.find((a) => a.id === sourceId);
      if (sourceAccount && !isFullyEntityOwned(sourceAccount)) {
        householdCashGiftsTotal += gift.amount;
      }
    }

    // Snapshot the checking balance *before* this year's inflows/outflows are applied
    // so we can attribute any drawdown of prior-year cash surplus as a "withdrawal
    // from cash" in the withdrawals drill-down.
    const checkingBalanceBeforeDeltas = hasChecking
      ? accountBalances[defaultChecking!.id] ?? 0
      : 0;

    // 11. Apply the accumulated cash deltas to balances and ledgers. Itemized entries
    // collected during creditCash are flushed onto the ledger in the order they were
    // recorded so the modal can show a per-year transaction list.
    //
    // For the household checking, contributions/distributions netting is deferred
    // until step 12 has applied taxes. Pre-tax flows (income, expenses, mortgage,
    // savings) and post-tax taxes then post as a single signed entry — Portfolio
    // Activity reports the true net change in cash instead of gross inflows split
    // from gross tax outflows.
    const householdCheckingId = hasChecking ? defaultChecking!.id : null;
    let checkingExternalDelta = 0;
    for (const [acctId, delta] of Object.entries(cashDelta)) {
      accountBalances[acctId] = (accountBalances[acctId] ?? 0) + delta;
      if (accountLedgers[acctId]) {
        accountLedgers[acctId].endingValue += delta;
        if (acctId === householdCheckingId) {
          checkingExternalDelta += delta;
        } else if (delta >= 0) {
          accountLedgers[acctId].contributions += delta;
        } else {
          accountLedgers[acctId].distributions += -delta;
        }
        const entries = pendingEntries[acctId];
        if (entries) accountLedgers[acctId].entries.push(...entries);
      }
    }

    // 11b. Pre-tax checking-balance baseline for the iterative convergence loop.
    // `preSupplementalChecking` is the checking balance after all non-tax flows but
    // BEFORE this year's tax expense. The convergence loop in phase 12 uses it as
    // the starting point and applies the converged tax + supplemental at the end.
    const preSupplementalChecking = hasChecking
      ? (accountBalances[defaultChecking!.id] ?? 0)
      : 0;

    // 12. Withdrawals + gap-fill. Household checking should never end the year
    // negative: any deficit after income/expenses/taxes/savings (and the BoY
    // purchase equity) is refilled from the withdrawal strategy (grossed up
    // for tax).
    let withdrawals = { byAccount: {} as Record<string, number>, total: 0 };
    const entityWithdrawals = { byAccount: {} as Record<string, number>, total: 0 };
    let withdrawalTax = 0;

    // Cash drawdown reporting is computed AFTER the convergence loop so it
    // accounts for taxes (which are paid from checking later in this phase).
    // See the post-convergence block below.

    // 12b. Build withdrawal source balances reflecting post-BoY-purchase state
    // so gap-fill doesn't pull from an account that was just drained to fund a
    // purchase. Withdrawals are scoped to the household share of each account
    // — entity-owned percentages stay with the entity and aren't tappable for
    // household shortfalls.
    // T9: use year-aware helper so gift events that transferred account ownership
    // to an entity reduce the household's tappable withdrawal balance starting
    // the year the gift fires.
    const householdWithdrawBalances: Record<string, number> = {};
    for (const acct of workingAccounts) {
      const householdShare = ownedByHouseholdAtYear(acct, data.giftEvents, year, planSettings.planStartYear);
      if (householdShare <= 0) continue;
      if (acct.isDefaultChecking) continue;
      const balance = acct.id in accountBalances ? accountBalances[acct.id] : 0;
      householdWithdrawBalances[acct.id] = balance * householdShare;
    }

    // Iterative tax + supplemental convergence (audit F5).
    //
    // Goal: settle on a (supplemental withdrawal, total tax) pair such that
    // checking ends within $1 of zero. Each iteration grows the cumulative
    // shortfall, plans a categorized supplemental withdrawal against that
    // shortfall, layers the recognized income on top of the baseline taxDetail,
    // and reruns the full tax pipeline. Converges in 1-3 iterations on typical
    // deficit years; MAX_ITER is a safety cap.
    const baselineTaxDetail = { ...taxDetail, bySource: { ...taxDetail.bySource } };
    const MAX_ITER = 5;
    const TOLERANCE = 1;

    let cumulativeShortfall = 0;
    let supplementalPlan: ReturnType<typeof planSupplementalWithdrawal> = {
      byAccount: {},
      total: 0,
      draws: [],
      recognizedIncome: { ordinaryIncome: 0, capitalGains: 0, earlyWithdrawalPenalty: 0 },
    };
    let taxOutForIter = taxOut;
    let convergenceWarning: TrustWarning | null = null;

    if (hasChecking) {
      let checkingAfterTax = preSupplementalChecking - taxOutForIter.taxes;

      const initialTaxes = taxOut.taxes;
      for (let iter = 0; iter < MAX_ITER; iter++) {
        if (Math.abs(checkingAfterTax) <= TOLERANCE) break;
        // Initial-surplus / final-surplus case with no draws-to-undo: nothing to do.
        // Without this, the loop spins MAX_ITER times on every non-deficit year and
        // emits a spurious convergenceWarning at the last iteration.
        if (checkingAfterTax > 0 && cumulativeShortfall === 0) break;

        // Newton-style step. Each unit of supplemental withdrawal produces
        // (taxOnIncrement + penaltyOnIncrement) of new tax burden, leaving
        // (1 - effectiveRate) units of net cash in checking. Divide the residual
        // by (1 - effectiveRate) so we converge in 1-2 iters under linear regimes
        // (typical) instead of 10+ under simple fixed-point. First iter uses the
        // unscaled residual since supplementalPlan is still empty.
        const supplementalCost =
          supplementalPlan.total > 0
            ? taxOutForIter.taxes - initialTaxes + supplementalPlan.recognizedIncome.earlyWithdrawalPenalty
            : 0;
        const effectiveRate =
          supplementalPlan.total > 0 ? supplementalCost / supplementalPlan.total : 0;
        const stepDenominator = Math.max(0.01, 1 - effectiveRate);

        if (checkingAfterTax < 0) {
          cumulativeShortfall += -checkingAfterTax / stepDenominator;
        } else if (cumulativeShortfall > 0) {
          cumulativeShortfall = Math.max(
            0,
            cumulativeShortfall - checkingAfterTax / stepDenominator,
          );
        }

        supplementalPlan = planSupplementalWithdrawal({
          shortfall: cumulativeShortfall,
          strategy: effectiveWithdrawalStrategy,
          householdBalances: householdWithdrawBalances,
          basisMap,
          rothValueMap,
          accounts: workingAccounts,
          ages: { client: ages.client, spouse: ages.spouse ?? null },
          isSpouseAccount,
          year,
        });

        const taxDetailWithSupp: typeof taxDetail = {
          ...baselineTaxDetail,
          ordinaryIncome:
            baselineTaxDetail.ordinaryIncome + supplementalPlan.recognizedIncome.ordinaryIncome,
          capitalGains:
            baselineTaxDetail.capitalGains + supplementalPlan.recognizedIncome.capitalGains,
          bySource: { ...baselineTaxDetail.bySource },
        };

        taxOutForIter = computeTaxForYear({
          taxDetail: taxDetailWithSupp,
          socialSecurityGross: income.socialSecurity,
          totalIncome: income.total,
          taxableIncome:
            taxableIncome
            + supplementalPlan.recognizedIncome.ordinaryIncome
            + supplementalPlan.recognizedIncome.capitalGains,
          filingStatus,
          year,
          planSettings,
          resolved: resolved ?? null,
          useBracket,
          aboveLineDeductions,
          itemizedDeductions,
          charityCarryforwardIn: charityCarryforward,
          charityGiftsThisYear,
          secaResult,
          transferEarlyWithdrawalPenalty: transferResult.earlyWithdrawalPenalty,
          interestIncomeForTax,
          deductionBreakdownIn: deductionBreakdownResult ?? null,
        });

        const taxAndPenalty =
          taxOutForIter.taxes + supplementalPlan.recognizedIncome.earlyWithdrawalPenalty;
        checkingAfterTax = preSupplementalChecking + supplementalPlan.total - taxAndPenalty;

        if (iter === MAX_ITER - 1 && Math.abs(checkingAfterTax) > TOLERANCE) {
          convergenceWarning = {
            code: "engine_iteration_limit",
            year,
            residual: checkingAfterTax,
            iterations: MAX_ITER,
          };
        }
      }
    }

    const finalTaxResult = taxOutForIter.taxResult;
    const finalTaxes = taxOutForIter.taxes;
    charityCarryforward = taxOutForIter.charityCarryforwardOut;
    deductionBreakdownResult = taxOutForIter.deductionBreakdown ?? undefined;
    const supplementalEarlyPenalty = supplementalPlan.recognizedIncome.earlyWithdrawalPenalty;

    // Layer supplemental recognized income onto taxDetail for the year output.
    const finalTaxDetail =
      supplementalPlan.total > 0
        ? {
            ...taxDetail,
            ordinaryIncome:
              taxDetail.ordinaryIncome + supplementalPlan.recognizedIncome.ordinaryIncome,
            capitalGains:
              taxDetail.capitalGains + supplementalPlan.recognizedIncome.capitalGains,
            bySource: { ...taxDetail.bySource },
          }
        : taxDetail;

    // Audit F5/F6: drill-down reconciliation. Each draw with non-zero recognized
    // income gets a `withdrawal:<acctId>` bySource entry so taxDetail.bySource sums
    // to the bucket totals.
    for (const draw of supplementalPlan.draws) {
      const recognized = draw.ordinaryIncome + draw.capitalGains;
      if (recognized <= 0) continue;
      const type: "ordinary_income" | "capital_gains" =
        draw.ordinaryIncome > 0 ? "ordinary_income" : "capital_gains";
      finalTaxDetail.bySource[`withdrawal:${draw.accountId}`] = { type, amount: recognized };
    }

    // Apply converged supplemental + taxes to balances and ledgers.
    if (hasChecking) {
      const checkingId = defaultChecking!.id;

      // Supplemental draws are attributed to the source account in Portfolio
      // Activity (not flagged internal) so the user sees which account funded
      // the shortfall. The cash side is symmetric: the refill credit is
      // internal, AND a matching slice of cash's distribution is also marked
      // internal — that pass-through portion is bookkeeping for money routed
      // through cash, not a real cash outflow.
      for (const draw of supplementalPlan.draws) {
        if (draw.amount <= 0) continue;
        const preBalance = accountBalances[draw.accountId] ?? 0;
        accountBalances[draw.accountId] -= draw.amount;
        withdrawals.byAccount[draw.accountId] =
          (withdrawals.byAccount[draw.accountId] ?? 0) + draw.amount;
        withdrawals.total += draw.amount;
        if (accountLedgers[draw.accountId]) {
          accountLedgers[draw.accountId].distributions += draw.amount;
          accountLedgers[draw.accountId].endingValue -= draw.amount;
          accountLedgers[draw.accountId].entries.push({
            category: "withdrawal",
            label: "Withdrawal to cover household shortfall",
            amount: -draw.amount,
          });
        }

        // Pro-rata basis reduction for taxable accounts. Mirrors the entity
        // gap-fill block below so subsequent years see basis tracking the
        // shrinking balance — without this, basis stays inflated and the
        // gain ratio collapses on every later draw from the same account.
        const drawAccount = accountById.get(draw.accountId);
        if (drawAccount?.category === "taxable" && preBalance > 0) {
          const fraction = Math.min(1, draw.amount / preBalance);
          basisMap[draw.accountId] = Math.max(
            0,
            (basisMap[draw.accountId] ?? 0) * (1 - fraction),
          );
        }

        // Pro-rata Roth-value reduction for 401k/403b sources. The tax-free
        // share already came out of OI in categorizeDraw via rothValueMap;
        // here we shrink the remaining Roth pool so subsequent years and
        // conversions see the right ratio.
        if (
          (drawAccount?.subType === "401k" || drawAccount?.subType === "403b") &&
          preBalance > 0
        ) {
          const fraction = Math.min(1, draw.amount / preBalance);
          rothValueMap[draw.accountId] = Math.max(
            0,
            (rothValueMap[draw.accountId] ?? 0) * (1 - fraction),
          );
        }
      }

      if (supplementalPlan.total > 0) {
        accountBalances[checkingId] += supplementalPlan.total;
        if (accountLedgers[checkingId]) {
          accountLedgers[checkingId].contributions += supplementalPlan.total;
          accountLedgers[checkingId].internalContributions += supplementalPlan.total;
          accountLedgers[checkingId].internalDistributions += supplementalPlan.total;
          accountLedgers[checkingId].endingValue += supplementalPlan.total;
          accountLedgers[checkingId].entries.push({
            category: "withdrawal",
            label: "Withdrawal to cover shortfall",
            amount: supplementalPlan.total,
            isInternalTransfer: true,
          });
        }
      }

      const taxAndPenalty = finalTaxes + supplementalEarlyPenalty;
      withdrawalTax = supplementalEarlyPenalty;

      // Cash drawdown reporting (was Phase 12a). When this year's net flow
      // (income/expenses/savings/mortgage AND tax) consumed prior-year cash
      // sitting in household checking, attribute the consumed portion as a
      // withdrawal from cash. Computed here, post-convergence, so taxes are
      // included in `consumed` — otherwise the Cash Assets withdrawal row
      // under-reports the household cash drain by exactly the year's tax bill.
      // Reporting-only; balance movement was already captured by individual
      // entries above and by the tax debit below.
      const endingBeforeSupplemental = preSupplementalChecking - taxAndPenalty;
      const consumedCash = checkingBalanceBeforeDeltas - endingBeforeSupplemental;
      const cashDrawdown = Math.max(
        0,
        Math.min(Math.max(0, checkingBalanceBeforeDeltas), consumedCash),
      );
      if (cashDrawdown > 0) {
        withdrawals.byAccount[checkingId] =
          (withdrawals.byAccount[checkingId] ?? 0) + cashDrawdown;
        withdrawals.total += cashDrawdown;
      }

      if (taxAndPenalty !== 0) {
        accountBalances[checkingId] -= taxAndPenalty;
        if (accountLedgers[checkingId]) {
          accountLedgers[checkingId].endingValue -= taxAndPenalty;
          accountLedgers[checkingId].entries.push({
            category: "tax",
            label:
              supplementalEarlyPenalty > 0
                ? "Income tax + 10% early-withdrawal penalty"
                : "Federal + state taxes",
            amount: -taxAndPenalty,
          });
        }
        checkingExternalDelta -= taxAndPenalty;
      }

      // Flush the deferred external net for the household checking. Pre-tax
      // flows from cashDelta and post-tax taxes converge into a single signed
      // contribution or distribution so Portfolio Activity reports true net
      // change in cash. Internal supplemental and entity-gap-fill flows are
      // posted to internalContributions/internalDistributions earlier in this
      // block and aren't part of the external net.
      if (accountLedgers[checkingId] && checkingExternalDelta !== 0) {
        if (checkingExternalDelta > 0) {
          accountLedgers[checkingId].contributions += checkingExternalDelta;
        } else {
          accountLedgers[checkingId].distributions += -checkingExternalDelta;
        }
      }
    } else {
      // TODO(F5-followup): unify with the iterative convergence path. This branch
      // doesn't gross up or model withdrawal tax — see future-work/engine.md
      // "Unify legacy no-checking path with iterative tax convergence".
      // Legacy path: no default checking → deficit triggers withdrawal directly
      // (no gross-up because the legacy path doesn't model the withdrawal tax
      // separately). Purchase equity is folded into outflows so a purchase-driven
      // deficit still triggers a withdrawal.
      const purchaseEquity = purchaseBreakdown.reduce((sum, p) => sum + p.equity, 0);
      const legacyNetFlow = householdInflows - householdNonSavingsOutflows - savings.total - purchaseEquity;
      if (legacyNetFlow < 0) {
        withdrawals = executeWithdrawals(
          -legacyNetFlow,
          effectiveWithdrawalStrategy,
          householdWithdrawBalances,
          year
        );
        for (const [acctId, amount] of Object.entries(withdrawals.byAccount)) {
          accountBalances[acctId] -= amount;
          if (accountLedgers[acctId]) {
            accountLedgers[acctId].distributions += amount;
            accountLedgers[acctId].endingValue -= amount;
            accountLedgers[acctId].entries.push({
              category: "withdrawal",
              label: "Withdrawal to cover shortfall",
              amount: -amount,
            });
          }
        }
      }
    }

    // 12c. Entity gap-fill — when an entity-owned expense or liability payment
    // drains the entity's default checking past zero, liquidate the entity's
    // own liquid assets to refill it. Mirrors the household gap-fill above but
    // scoped per-entity. Tax gross-up is intentionally skipped (v1): trust
    // marginal rate isn't available at this point in the year, and the trust
    // 1041 tax on the realized gain is paid the following year via the
    // deferred-realization carry-over (see notes below). When the entity has
    // no remaining liquid assets, checking stays negative and an
    // `entity_overdraft` warning surfaces.
    const entityGapFillWarnings: TrustWarning[] = [];
    for (const [entityId, checkingId] of Object.entries(entityCheckingByEntityId)) {
      const balance = accountBalances[checkingId] ?? 0;
      if (balance >= 0) continue;
      const shortfall = -balance;

      // Per-entity balance pool: 100% entity-owned accounts only (controllingEntity
      // returns the lone entity owner when share is exactly 100%). Excludes the
      // entity's own checking (target, not source) and untappable categories
      // (categoryWithdrawalPriority returns null for real-estate, business,
      // life-insurance — they can't be liquidated cleanly at year boundaries).
      const entityBalances: Record<string, number> = {};
      const liquidatableAcctById = new Map<string, Account>();
      for (const acct of workingAccounts) {
        if (controllingEntity(acct) !== entityId) continue;
        if (acct.id === checkingId) continue;
        if (categoryWithdrawalPriority(acct) == null) continue;
        entityBalances[acct.id] = accountBalances[acct.id] ?? 0;
        liquidatableAcctById.set(acct.id, acct);
      }

      const entityStrategy = buildEntityWithdrawalStrategy(
        entityId,
        workingAccounts,
        planSettings,
      );
      const liquidations = executeWithdrawals(
        shortfall,
        entityStrategy,
        entityBalances,
        year,
      );

      for (const [acctId, amount] of Object.entries(liquidations.byAccount)) {
        if (amount <= 0) continue;
        const preBalance = entityBalances[acctId] ?? 0;
        accountBalances[acctId] -= amount;
        accountBalances[checkingId] += amount;

        // Track the liquidation under entityWithdrawals so cap-gain attribution
        // still has a per-account total to point at, but kept separate from
        // household `withdrawals` — the Net Cash Flow drill is supposed to
        // surface household supplemental draws only, not entity-internal
        // refills.
        entityWithdrawals.byAccount[acctId] =
          (entityWithdrawals.byAccount[acctId] ?? 0) + amount;
        entityWithdrawals.total += amount;

        // Symmetric to the supplemental-draw block above: entity gap-fill draws
        // are attributed to the source so Portfolio Activity surfaces the real
        // funding account, and a matching slice of cash's distribution is
        // marked internal to neutralize the pass-through.
        if (accountLedgers[acctId]) {
          accountLedgers[acctId].distributions += amount;
          accountLedgers[acctId].endingValue -= amount;
          accountLedgers[acctId].entries.push({
            category: "withdrawal",
            label: "Entity gap-fill",
            amount: -amount,
          });
        }
        if (accountLedgers[checkingId]) {
          accountLedgers[checkingId].contributions += amount;
          accountLedgers[checkingId].internalContributions += amount;
          accountLedgers[checkingId].internalDistributions += amount;
          accountLedgers[checkingId].endingValue += amount;
          accountLedgers[checkingId].entries.push({
            category: "withdrawal",
            label: "Refill from entity liquidation",
            amount,
            isInternalTransfer: true,
          });
        }

        // Cap-gains realization wiring for taxable liquidations. Compute the
        // pro-rata gain against the pre-liquidation balance, reduce basis by
        // the same fraction, and stash the gain for NEXT year's trust-tax pass
        // (deferred — trust marginal rate isn't available at gap-fill time).
        // Routing (grantor → household 1040 vs non-grantor → trust 1041)
        // happens at drain time in next year's loop iteration so a grantor
        // flip in the intervening year is honored.
        const acct = liquidatableAcctById.get(acctId);
        if (acct?.category === "taxable" && preBalance > 0) {
          const acctBasis = basisMap[acctId] ?? preBalance;
          const fraction = Math.min(1, amount / preBalance);
          const gain = Math.max(0, amount - acctBasis * fraction);
          basisMap[acctId] = Math.max(0, acctBasis * (1 - fraction));
          if (gain > 0) {
            deferredEntityLiquidationGains.push({
              entityId,
              accountId: acctId,
              gain,
            });
          }
        }
      }

      if (accountBalances[checkingId] < 0) {
        entityGapFillWarnings.push({
          code: "entity_overdraft",
          entityId,
          shortfall: -accountBalances[checkingId],
        });
      }
    }

    // 13. Portfolio snapshot. An account is included if it has no entity owner or if
    // its entity is flagged to roll into portfolio assets. Non-IIP entity shares
    // route to trustsAndBusinesses or accessibleTrustAssets based on the entity's
    // accessibleToClient flag.
    const portfolioAssets = {
      taxable: {} as Record<string, number>,
      cash: {} as Record<string, number>,
      retirement: {} as Record<string, number>,
      realEstate: {} as Record<string, number>,
      business: {} as Record<string, number>,
      lifeInsurance: {} as Record<string, number>,
      trustsAndBusinesses: {} as Record<string, number>,
      accessibleTrustAssets: {} as Record<string, number>,
      taxableTotal: 0,
      cashTotal: 0,
      retirementTotal: 0,
      realEstateTotal: 0,
      businessTotal: 0,
      lifeInsuranceTotal: 0,
      trustsAndBusinessesTotal: 0,
      accessibleTrustAssetsTotal: 0,
      total: 0,
    };
    const categoryToKey: Record<string, "taxable" | "cash" | "retirement" | "realEstate" | "business" | "lifeInsurance"> = {
      taxable: "taxable",
      cash: "cash",
      retirement: "retirement",
      real_estate: "realEstate",
      business: "business",
      life_insurance: "lifeInsurance",
    };
    for (const acct of workingAccounts) {
      const val = accountBalances[acct.id] ?? 0;
      // T7: use year-aware helper so gift events that transfer ownership to an
      // entity are reflected in the correct year's balance-sheet snapshot.
      // T9: also use year-aware owners for the entity-side loop so includeInPortfolio
      // entities that receive ownership via a gift are counted starting the gift year.
      const portfolioYearOwners = ownersForYear(acct, data.giftEvents, year, planSettings.planStartYear);

      // ── Pass 1: existing in-portfolio share (household + IIP entity) by category ──
      let inPortfolioFraction = portfolioYearOwners
        .filter((o) => o.kind === "family_member")
        .reduce((s, o) => s + o.percent, 0);
      for (const owner of portfolioYearOwners) {
        if (owner.kind !== "entity") continue;
        const entity = entityMap[owner.entityId];
        if (entity?.includeInPortfolio) inPortfolioFraction += owner.percent;
      }
      if (inPortfolioFraction > 0) {
        const inPortfolioVal = val * inPortfolioFraction;
        const key = categoryToKey[acct.category] ?? "taxable";
        portfolioAssets[key][acct.id] = inPortfolioVal;
        const totalKey = `${key}Total` as keyof typeof portfolioAssets;
        (portfolioAssets[totalKey] as number) += inPortfolioVal;

        // Mirror household + IIP-entity *business-category* shares into the
        // "Trusts and Businesses" bucket so the column reflects all directly-
        // held business interests too. (Real estate stays in its own column —
        // only category=business mirrors here.)
        if (key === "business") {
          portfolioAssets.trustsAndBusinesses[acct.id] =
            (portfolioAssets.trustsAndBusinesses[acct.id] ?? 0) + inPortfolioVal;
          portfolioAssets.trustsAndBusinessesTotal += inPortfolioVal;
        }
      }

      // ── Pass 2: non-IIP entity shares — route by accessibleToClient ──
      for (const owner of portfolioYearOwners) {
        if (owner.kind !== "entity") continue;
        const entity = entityMap[owner.entityId];
        if (!entity || entity.includeInPortfolio) continue; // already counted above
        const share = val * owner.percent;
        if (share <= 0) continue;
        const bucket = entity.accessibleToClient
          ? "accessibleTrustAssets"
          : "trustsAndBusinesses";
        portfolioAssets[bucket][acct.id] =
          (portfolioAssets[bucket][acct.id] ?? 0) + share;
        const totalKey = (bucket + "Total") as
          | "trustsAndBusinessesTotal"
          | "accessibleTrustAssetsTotal";
        portfolioAssets[totalKey] += share;
      }
    }
    portfolioAssets.total =
      portfolioAssets.taxableTotal +
      portfolioAssets.cashTotal +
      portfolioAssets.retirementTotal +
      portfolioAssets.realEstateTotal +
      portfolioAssets.businessTotal +
      portfolioAssets.lifeInsuranceTotal;
    // Note: `total` intentionally stays as the legacy IIP-only sum so existing
    // consumers (BoY portfolio lookup, etc.) keep working. The cashflow drill
    // computes its grand total locally from all the *Total fields.

    // 14. Assemble the year. P&L-style totals:
    //   Total Income   = earned income + household RMDs  (no withdrawals — those are
    //                    a balancing mechanism below the P&L)
    //   Total Expenses = base expenses + savings + taxes  (taxes includes both the
    //                    income/RMD tax and the gross-up tax on any supplemental
    //                    withdrawal the engine made to refill household cash)
    //   Net Cash Flow  = Total Income - Total Expenses   (can be negative)
    // When Net Cash Flow is negative, |Net Cash Flow| equals the gross withdrawal the
    // engine actually pulled from the strategy, so the two reconcile — household cash
    // drops by |Net Cash Flow| and the withdrawal refills it by the same amount.
    // ── Technique income and expenses ──────────────────────────────────────
    // Sale proceeds (net of transaction costs and mortgage payoff) are "other"
    // income.  Transaction costs from sales and equity outflows from purchases
    // are "other" expenses.  These show up in the cash-flow drill-down so
    // advisors can see the P&L impact of techniques.
    let techniqueIncome = 0;
    const techniqueIncomeBySource: Record<string, number> = {};
    let techniqueExpenses = 0;
    const techniqueExpenseBySource: Record<string, number> = {};

    // Year-level netting: when sales and purchases coexist in the same year,
    // absorb same-year purchase equity against same-year sale netProceeds
    // before surfacing either side in the cash flow. This matches advisor
    // intuition for a "swap" (sell one property, buy another) — the headline
    // cash impact is the NET of both legs, not the raw sale proceeds with the
    // purchase equity shown in a separate column.
    //
    // Distribution rules:
    //   totalAbsorption = min(Σ sale.netProceeds, Σ purchase.equity)
    //   Each sale's surfaced income = sale.netProceeds - (sale.netProceeds / Σ netProceeds) × totalAbsorption
    //   Each purchase's surfaced expense = purchase.equity - (purchase.equity / Σ equity) × totalAbsorption
    // After distribution, sum of income bySource entries = max(0, yearNet);
    // sum of purchase bySource entries = max(0, -yearNet).
    //
    // Transaction costs are NOT a separate expense line — they're already
    // deducted from netProceeds (in applyAssetSales) and surface in the sale
    // drill-down breakdown.
    const totalNetProceeds = saleResult.breakdown.reduce((s, x) => s + x.netProceeds, 0);
    const totalPurchaseEquity = purchaseBreakdown.reduce((s, x) => s + x.equity, 0);
    const absorption = Math.min(totalNetProceeds, totalPurchaseEquity);

    for (const item of saleResult.breakdown) {
      const saleShare = totalNetProceeds > 0 ? item.netProceeds / totalNetProceeds : 0;
      const netImpact = item.netProceeds - absorption * saleShare;

      if (netImpact > 0) {
        techniqueIncome += netImpact;
        techniqueIncomeBySource[`technique-proceeds:${item.transactionId}`] = netImpact;
      }
    }

    for (const item of purchaseBreakdown) {
      if (item.equity <= 0) continue;
      const purchaseShare = totalPurchaseEquity > 0 ? item.equity / totalPurchaseEquity : 0;
      const uncoveredEquity = item.equity - absorption * purchaseShare;

      if (uncoveredEquity > 0) {
        techniqueExpenses += uncoveredEquity;
        techniqueExpenseBySource[`technique-purchase:${item.transactionId}`] = uncoveredEquity;
      }
    }

    // Fold technique amounts into income
    income.other += techniqueIncome;
    income.total += techniqueIncome;
    Object.assign(income.bySource, techniqueIncomeBySource);

    // Audit F5: surface withdrawal penalties so expenses.bySource drill-down
    // reconciles with the converged tax line.
    const penaltyBySource: Record<string, number> = {};
    for (const draw of supplementalPlan.draws) {
      if (draw.earlyWithdrawalPenalty > 0) {
        penaltyBySource[`withdrawal_penalty:${draw.accountId}`] = draw.earlyWithdrawalPenalty;
      }
    }

    const totalTaxes = hasChecking ? finalTaxes + supplementalEarlyPenalty : taxes;
    // Property tax only counts toward the household realEstate bucket for the
    // household-share synthetic rows. Entity-owned shares are tagged with
    // ownerEntityId and route to the entity's checking via resolveCashAccount.
    const householdSyntheticExpenseTotal = syntheticExpenses
      .filter((s) => s.ownerEntityId == null)
      .reduce((sum, s) => sum + s.annualAmount, 0);
    const expenses = {
      living: expenseBreakdown.living,
      liabilities: liabResult.totalPayment,
      other: expenseBreakdown.other + techniqueExpenses + householdCashGiftsTotal,
      insurance: expenseBreakdown.insurance,
      realEstate: householdSyntheticExpenseTotal,
      taxes: totalTaxes,
      cashGifts: householdCashGiftsTotal,
      total:
        expenseBreakdown.living +
        expenseBreakdown.other +
        expenseBreakdown.insurance +
        householdSyntheticExpenseTotal +
        liabResult.totalPayment +
        totalTaxes +
        techniqueExpenses +
        householdCashGiftsTotal,
      bySource: {
        ...expenseBreakdown.bySource,
        ...Object.fromEntries(
          syntheticExpenses
            .filter((s) => s.ownerEntityId == null)
            .map((s) => [s.id, s.annualAmount])
        ),
        ...techniqueExpenseBySource,
        ...penaltyBySource,
      },
      byLiability: liabResult.byLiability,
      interestByLiability: liabResult.interestByLiability,
    };

    // Cash Flow > Income, Business column: show actual cash received by the
    // household from entity distributions, not gross entity income. Sum every
    // positive (= credit) entity_distribution ledger entry — only destination
    // accounts (household / family-member checking) get a positive entry; the
    // entity-side debit is negative and excluded by the > 0 filter. Per-entity
    // bySource is keyed by entity.id so the drill-down can label rows by
    // entity name.
    let businessDistributions = 0;
    const businessDistributionsBySource: Record<string, number> = {};
    for (const acct of workingAccounts) {
      const ledger = accountLedgers[acct.id];
      if (!ledger) continue;
      for (const entry of ledger.entries) {
        if (entry.category !== "entity_distribution") continue;
        if (entry.amount <= 0) continue;
        businessDistributions += entry.amount;
        if (entry.sourceId) {
          businessDistributionsBySource[entry.sourceId] =
            (businessDistributionsBySource[entry.sourceId] ?? 0) + entry.amount;
        }
      }
    }

    // Roll household-only and grantor-entity NON-business streams into the
    // displayed income buckets. Business is special: it shows distributions
    // (cash received), not the gross entity income that grantorIncome.business
    // contains. See spec 2026-05-11-business-distribution-passthrough-design.
    const displayIncome = {
      salaries: income.salaries + grantorIncome.salaries,
      socialSecurity: income.socialSecurity + grantorIncome.socialSecurity,
      business: income.business + businessDistributions,
      trust: income.trust + grantorIncome.trust,
      deferred: income.deferred + grantorIncome.deferred,
      capitalGains: income.capitalGains + grantorIncome.capitalGains,
      other: income.other + grantorIncome.other,
      total:
        income.total
        + grantorIncome.total
        - grantorIncome.business // subtract gross to avoid double-count with businessDistributions
        + businessDistributions,
      bySource: {
        ...income.bySource,
        ...grantorIncome.bySource,
        ...businessDistributionsBySource, // entity-id keys for the Business drill-down
      },
      ...(income.socialSecurityDetail
        ? { socialSecurityDetail: income.socialSecurityDetail }
        : {}),
    };
    // Strip grantor-entity business gross from bySource — these were keyed by
    // income row id (not entity id), and they no longer represent what shows
    // in the Business column. Leave them out so the drill-down sums match.
    for (const inc of currentIncomes) {
      if (inc.type !== "business") continue;
      if (inc.ownerEntityId == null) continue; // household business — keep
      if (!isGrantorEntity(inc.ownerEntityId)) continue; // non-grantor: never in bySource here
      delete displayIncome.bySource[inc.id];
    }
    const totalIncome = displayIncome.total + householdRmdIncome;
    const totalExpenses = expenses.total + savings.total;
    const netCashFlow = totalIncome - totalExpenses;

    // Build technique breakdown for drill-down UI
    const hasTechniques = saleResult.breakdown.length > 0 || purchaseBreakdown.length > 0;
    const txnNameMap = new Map((data.assetTransactions ?? []).map((t) => [t.id, t.name]));

    // Snapshot end-of-year account balances for gift-year value lookups at death.
    yearEndAccountBalances.set(year, { ...accountBalances });

    // 4d-2: hypothetical estate tax — computed on the pre-real-death snapshot
    // of year-N state, so the report always displays consistent "both die in
    // year N" numbers regardless of where real deaths land. Attached to the
    // ProjectionYear at push time so the required field is always populated.
    const clientFilingStatus = (client.filingStatus ?? "single") as FilingStatus;
    const hypotheticalIsMarried =
      clientFilingStatus === "married_joint" ||
      clientFilingStatus === "married_separate";
    const hypotheticalEstateTax = computeHypotheticalEstateTax({
      year,
      isMarried: hypotheticalIsMarried,
      accounts: workingAccounts,
      accountBalances,
      basisMap,
      incomes: currentIncomes,
      liabilities: currentLiabilities,
      familyMembers: data.familyMembers ?? [],
      externalBeneficiaries: data.externalBeneficiaries ?? [],
      entities: currentEntities,
      wills: data.wills ?? [],
      planSettings,
      gifts: data.gifts ?? [],
      giftEvents: data.giftEvents,
      yearEndAccountBalances,
      annualExclusionsByYear,
    });

    // Stamp end-of-year basis onto each ledger now that all sales, growth
    // realization, contributions, and Roth conversions have settled. Death-
    // event mutations to basisMap happen *after* this push and land on the
    // next year's BoY, which is the right semantics for the drill-down view.
    for (const acctId of Object.keys(accountLedgers)) {
      accountLedgers[acctId].basisEoY = basisMap[acctId] ?? 0;
      accountLedgers[acctId].rothValueEoY = rothValueMap[acctId] ?? 0;
    }

    years.push({
      year,
      ages,
      income: displayIncome,
      ...(income.socialSecurityDetail ? { socialSecurityDetail: income.socialSecurityDetail } : {}),
      taxDetail: finalTaxDetail,
      taxResult: finalTaxResult,
      charityCarryforward,
      charitableOutflows: clutCharitableOutflowsTotal,
      ...(clutCharitableOutflowDetail.length > 0
        ? { charitableOutflowDetail: clutCharitableOutflowDetail }
        : {}),
      ...(yearTrustTerminations.length > 0
        ? { trustTerminations: yearTrustTerminations }
        : {}),
      deductionBreakdown: deductionBreakdownResult,
      withdrawals,
      entityWithdrawals,
      expenses,
      savings,
      totalIncome,
      totalExpenses,
      netCashFlow,
      portfolioAssets,
      accountLedgers,
      accountBasisBoY,
      liabilityBalancesBoY,
      hypotheticalEstateTax,
      entityCashFlow: new Map(),
      ...(Object.keys(rothConversionResult.byConversion).length > 0
        ? {
            rothConversions: Object.entries(rothConversionResult.byConversion).map(
              ([id, info]) => ({
                id,
                name: data.rothConversions?.find((c) => c.id === id)?.name ?? id,
                gross: info.gross,
                taxable: info.taxable,
              }),
            ),
          }
        : {}),
      ...(hasTechniques
        ? {
            techniqueBreakdown: {
              sales: saleResult.breakdown.map((s) => ({
                transactionId: s.transactionId,
                name: txnNameMap.get(s.transactionId) ?? s.transactionId,
                saleValue: s.saleValue,
                transactionCosts: s.transactionCosts,
                mortgagePaidOff: s.mortgagePaidOff,
                netProceeds: s.netProceeds,
                capitalGain: s.capitalGain,
              })),
              purchases: purchaseBreakdown.map((p) => ({
                transactionId: p.transactionId,
                name: p.name,
                purchasePrice: p.purchasePrice,
                mortgageAmount: p.mortgageAmount,
                equity: p.equity,
                liabilityId: p.liabilityId,
                liabilityName: p.liabilityName,
              })),
            },
          }
        : {}),
      ...(trustPassResult != null
       || grantorDistributionWarnings.length > 0
       || entityGapFillWarnings.length > 0
       || convergenceWarning != null
        ? {
            ...(trustPassResult != null ? {
              trustTaxByEntity: trustPassResult.taxByEntity,
              trustDistributionsByEntity: new Map(
                Array.from(trustPassResult.distributionsByEntity.entries(),
                  ([eid, d]) => [eid, d.drawFromCash ?? 0]),
              ),
              estimatedBeneficiaryTax: trustPassResult.estimatedBeneficiaryTax,
            } : {}),
            trustWarnings: (() => {
              const all = [
                ...(trustPassResult?.warnings ?? []),
                ...grantorDistributionWarnings,
                ...entityGapFillWarnings,
                ...(convergenceWarning != null ? [convergenceWarning] : []),
              ];
              return all.length > 0 ? all : undefined;
            })(),
          }
        : {}),
    });

    // Roll the locked-share carry forward for this year so the death-event
    // call sites can pass an accurate entityAccountSharesEoY snapshot. We
    // recompute it for every year (not just death years) so the carry stays
    // monotonic — accrueLockedEntityShare relies on the prior EoY being
    // present for every split-owned account. This is independent of the
    // post-loop computeEntityCashFlow / computeFamilyAccountShares passes;
    // both paths consume accrueLockedEntityShare and produce the same
    // numbers.
    const thisYear = years[years.length - 1];
    for (const acct of workingAccounts) {
      const ledger = thisYear.accountLedgers[acct.id];
      if (!ledger) continue;
      for (const o of acct.owners) {
        if (o.kind !== "entity") continue;
        if (o.percent >= 1) continue; // 100%-entity needs no carry — full ledger is the share
        const carried = lockedEntityShareCarry.get(o.entityId)?.get(acct.id);
        const acc = accrueLockedEntityShare({
          carriedBoY: carried,
          ledger: { beginningValue: ledger.beginningValue, growth: ledger.growth },
          percent: o.percent,
        });
        if (!lockedEntityShareCarry.has(o.entityId)) {
          lockedEntityShareCarry.set(o.entityId, new Map());
        }
        lockedEntityShareCarry.get(o.entityId)!.set(acct.id, acc.lockedEoY);
      }
    }

    // Death event (spec 4b) — fires exactly once at the first death year.
    if (
      firstDeathYear != null &&
      firstDeathDeceased != null &&
      firstDeathSurvivor != null &&
      year === firstDeathYear
    ) {
      const deceasedWill = (data.wills ?? []).find(
        (w) => w.grantor === firstDeathDeceased,
      ) ?? null;

      const deathResult = applyFirstDeath({
        year,
        deceased: firstDeathDeceased,
        survivor: firstDeathSurvivor,
        will: deceasedWill,
        accounts: workingAccounts,
        accountBalances,
        basisMap,
        incomes: currentIncomes,
        liabilities: currentLiabilities,
        familyMembers: data.familyMembers ?? [],
        externalBeneficiaries: data.externalBeneficiaries ?? [],
        entities: currentEntities,
        planSettings,
        gifts: data.gifts ?? [],
        giftEvents: data.giftEvents,
        yearEndAccountBalances,
        annualExclusionsByYear,
        dsueReceived: 0, // first decedent has no prior DSUE
        priorTaxableGifts: data.planSettings.priorTaxableGifts ?? { client: 0, spouse: 0 },
        entityAccountSharesEoY: lockedEntityShareCarry,
        familyAccountSharesEoY: lockedFamilyShareCarry,
      });

      // Death-event creates synthetic accounts/liabilities mid-projection with
      // legacy ownership fields populated but `owners[]` empty. Normalize so
      // subsequent year iterations read fractional ownership consistently.
      workingAccounts = deathResult.accounts.map(normalizeOwners);
      // Reassign the mutable balance / basis maps in place so later years see the new state.
      for (const key of Object.keys(accountBalances)) delete (accountBalances as Record<string, number>)[key];
      Object.assign(accountBalances, deathResult.accountBalances);
      for (const key of Object.keys(basisMap)) delete (basisMap as Record<string, number>)[key];
      Object.assign(basisMap, deathResult.basisMap);
      currentIncomes = deathResult.incomes;
      currentLiabilities = deathResult.liabilities.map(normalizeOwners);
      // Adopt grantor-succession entity flips (e.g. IDGT post-grantor-death).
      // Trust-tax classification reads `currentEntities` at the top of each
      // subsequent year, so the next iteration picks up the flipped state.
      currentEntities = deathResult.entities;
      rebuildEntityMap();

      // Stash DSUE for the final-death call (portability per §2010(c)(4)).
      stashedDSUE = deathResult.dsueGenerated;

      // Attach to the just-built ProjectionYear
      const thisYear = years[years.length - 1];
      thisYear.deathTransfers = deathResult.transfers;
      thisYear.deathWarnings = deathResult.warnings;
      thisYear.estateTax = deathResult.estateTax;
    }

    // Final-death event (spec 4c) — fires at the final death year. For
    // same-year double death, fires the same year as 4b on the already-4b-
    // mutated state. After this block, break out of the year loop to
    // truncate the projection.
    if (
      finalDeathYear != null &&
      finalDeceased != null &&
      year === finalDeathYear
    ) {
      const finalWill = (data.wills ?? []).find(
        (w) => w.grantor === finalDeceased,
      ) ?? null;

      const finalResult = applyFinalDeath({
        year,
        deceased: finalDeceased,
        // survivor field is unused by applyFinalDeath internally; pass
        // deceased as a safe placeholder to keep the shared input type.
        survivor: finalDeceased,
        will: finalWill,
        accounts: workingAccounts,
        accountBalances,
        basisMap,
        incomes: currentIncomes,
        liabilities: currentLiabilities,
        familyMembers: data.familyMembers ?? [],
        externalBeneficiaries: data.externalBeneficiaries ?? [],
        entities: currentEntities,
        planSettings,
        gifts: data.gifts ?? [],
        giftEvents: data.giftEvents,
        yearEndAccountBalances,
        annualExclusionsByYear,
        dsueReceived: stashedDSUE,
        priorTaxableGifts: data.planSettings.priorTaxableGifts ?? { client: 0, spouse: 0 },
        entityAccountSharesEoY: lockedEntityShareCarry,
        familyAccountSharesEoY: lockedFamilyShareCarry,
      });

      // Same normalization as first-death — keeps fractional reads consistent
      // for the truncated final-year processing below.
      workingAccounts = finalResult.accounts.map(normalizeOwners);
      for (const key of Object.keys(accountBalances)) delete (accountBalances as Record<string, number>)[key];
      Object.assign(accountBalances, finalResult.accountBalances);
      for (const key of Object.keys(basisMap)) delete (basisMap as Record<string, number>)[key];
      Object.assign(basisMap, finalResult.basisMap);
      currentIncomes = finalResult.incomes;
      currentLiabilities = finalResult.liabilities.map(normalizeOwners);
      // Adopt grantor-succession entity flips at final death. The loop breaks
      // immediately after, but keep the map in sync for any post-loop reads.
      currentEntities = finalResult.entities;
      rebuildEntityMap();

      const thisYear = years[years.length - 1];
      thisYear.deathTransfers = [
        ...(thisYear.deathTransfers ?? []),
        ...finalResult.transfers,
      ];
      thisYear.deathWarnings = [
        ...(thisYear.deathWarnings ?? []),
        ...finalResult.warnings,
      ];
      thisYear.estateTax = finalResult.estateTax;

      break;
    }
  }

  // ── Entity cash-flow pass ──────────────────────────────────────────────────
  // Runs once after every year is finalized. Mutates years[i].entityCashFlow
  // in place, populating one row per entity per year.
  const entitiesById = new Map<string, EntityMetadata>();
  for (const entity of data.entities ?? []) {
    entitiesById.set(entity.id, {
      id: entity.id,
      name: entity.name ?? entity.id,
      entityType: entity.entityType ?? "trust",
      trustSubType: entity.trustSubType ?? null,
      isGrantor: entity.isGrantor,
      initialValue: entity.value ?? 0,
      initialBasis: entity.basis ?? 0,
      flowMode: entity.flowMode ?? "annual",
      valueGrowthRate: entity.valueGrowthRate ?? null,
    });
  }
  // Account → entity-owner map. Any account with an entity-owner row
  // contributes to that entity's rollup at its share percent (split
  // ownership with a family member is supported). Accounts split between
  // multiple entities are not yet modeled — the first entity-owner wins.
  const accountEntityOwners = new Map<string, { entityId: string; percent: number }>();
  for (const acct of data.accounts) {
    const entityOwner = acct.owners.find((o) => o.kind === "entity") as
      | { kind: "entity"; entityId: string; percent: number }
      | undefined;
    if (entityOwner) {
      accountEntityOwners.set(acct.id, {
        entityId: entityOwner.entityId,
        percent: entityOwner.percent,
      });
    }
  }
  // Gifts to entities, grouped by recipient entity id and year. Only cash gifts
  // carry a numeric `amount` field; asset/liability gifts use the same value
  // model elsewhere and are surfaced via account ledgers, so they are not
  // double-counted here.
  const giftsByEntityYear = new Map<string, Map<number, number>>();
  for (const ge of data.giftEvents ?? []) {
    if (!ge.recipientEntityId) continue;
    if (ge.kind !== "cash") continue;
    const inner = giftsByEntityYear.get(ge.recipientEntityId) ?? new Map<number, number>();
    inner.set(ge.year, (inner.get(ge.year) ?? 0) + ge.amount);
    giftsByEntityYear.set(ge.recipientEntityId, inner);
  }
  computeEntityCashFlow({
    years,
    entitiesById,
    accountEntityOwners,
    giftsByEntityYear,
    incomes: currentIncomes,
    expenses: lastAllExpenses,
    entityFlowOverrides: data.entityFlowOverrides ?? [],
    client: data.client,
  });

  // Per-family-member locked-share ledger for jointly-held accounts. Only
  // accounts with ≥2 distinct family-member owners get a per-member ledger.
  const accountFamilyOwners = new Map<string, Array<{ familyMemberId: string; percent: number }>>();
  for (const acct of data.accounts ?? []) {
    const fmOwners = (acct.owners ?? [])
      .filter(
        (o): o is { kind: "family_member"; familyMemberId: string; percent: number } =>
          o.kind === "family_member",
      )
      .map((o) => ({ familyMemberId: o.familyMemberId, percent: o.percent }));
    if (fmOwners.length >= 2) {
      accountFamilyOwners.set(acct.id, fmOwners);
    }
  }
  computeFamilyAccountShares({
    years,
    accountFamilyOwners,
    clientFamilyMemberId: clientFmId,
    spouseFamilyMemberId: spouseFmId,
    incomes: currentIncomes,
    gifts: data.giftEvents ?? [],
    familyMembers: data.familyMembers ?? [],
  });

  // Post-pass: rewrite portfolioAssets per-account values for split-owned
  // accounts using the locked entity shares the balance sheet relies on.
  // Without this, household withdrawals reduce the entity's snapshot share
  // pro-rata via val × ownerPercent (the year-loop's snapshot uses the
  // post-withdrawal account total). The balance sheet view-model carries
  // entityAccountSharesEoY year-over-year so the entity portion is locked
  // to its own beginning balance + its share of growth — household flows
  // never bleed into it. This pass aligns the cash-flow drilldown with
  // that same accounting.
  const stableEntityById: Record<string, EntitySummary> = {};
  for (const e of data.entities ?? []) stableEntityById[e.id] = e;
  const portfolioCategoryToKey: Record<
    string,
    "taxable" | "cash" | "retirement" | "realEstate" | "business" | "lifeInsurance"
  > = {
    taxable: "taxable",
    cash: "cash",
    retirement: "retirement",
    real_estate: "realEstate",
    business: "business",
    life_insurance: "lifeInsurance",
  };
  for (const year of years) {
    let mutated = false;
    for (const acct of data.accounts ?? []) {
      const entityOwner = acct.owners.find((o) => o.kind === "entity") as
        | { kind: "entity"; entityId: string; percent: number }
        | undefined;
      if (!entityOwner) continue;
      if (entityOwner.percent >= 1) continue; // 100%-entity-owned: snapshot already correct
      const entityLocked = year.entityAccountSharesEoY
        ?.get(entityOwner.entityId)
        ?.get(acct.id);
      if (entityLocked == null) continue;
      const ledger = year.accountLedgers[acct.id];
      if (!ledger) continue;
      const entity = stableEntityById[entityOwner.entityId];
      const primaryKey = portfolioCategoryToKey[acct.category] ?? "taxable";

      // Clear stale per-account entries so we can write the locked-share split fresh.
      delete year.portfolioAssets[primaryKey][acct.id];
      delete year.portfolioAssets.trustsAndBusinesses[acct.id];
      delete year.portfolioAssets.accessibleTrustAssets[acct.id];

      if (entity?.includeInPortfolio) {
        // IIP entity: HH + IIP-entity together fill the primary bucket.
        // (Locked share exists but the drilldown bundles them — same as the
        // original Pass 1 behavior, just sourced from ledger.endingValue
        // instead of accountBalances × inPortfolioFraction so it stays
        // consistent across paths.)
        const inPortfolioVal = ledger.endingValue;
        if (inPortfolioVal > 0) {
          year.portfolioAssets[primaryKey][acct.id] = inPortfolioVal;
          if (primaryKey === "business") {
            year.portfolioAssets.trustsAndBusinesses[acct.id] = inPortfolioVal;
          }
        }
      } else {
        // Non-IIP entity: family pool = ledger.endingValue − entity locked.
        // Entity slice routes by accessibleToClient. Mirror business → t&b.
        const familyPool = Math.max(0, ledger.endingValue - entityLocked);
        if (familyPool > 0) {
          year.portfolioAssets[primaryKey][acct.id] = familyPool;
          if (primaryKey === "business") {
            year.portfolioAssets.trustsAndBusinesses[acct.id] = familyPool;
          }
        }
        const entityBucket = entity?.accessibleToClient
          ? "accessibleTrustAssets"
          : "trustsAndBusinesses";
        if (entityLocked > 0) {
          year.portfolioAssets[entityBucket][acct.id] =
            (year.portfolioAssets[entityBucket][acct.id] ?? 0) + entityLocked;
        }
      }
      mutated = true;
    }

    if (!mutated) continue;

    // Recompute bucket totals from the per-bucket maps so they stay in sync.
    const bucketKeys = [
      "taxable",
      "cash",
      "retirement",
      "realEstate",
      "business",
      "lifeInsurance",
      "trustsAndBusinesses",
      "accessibleTrustAssets",
    ] as const;
    for (const b of bucketKeys) {
      const map = year.portfolioAssets[b];
      const total = Object.values(map).reduce((s, v) => s + v, 0);
      (year.portfolioAssets[`${b}Total`] as number) = total;
    }
    year.portfolioAssets.total =
      year.portfolioAssets.taxableTotal +
      year.portfolioAssets.cashTotal +
      year.portfolioAssets.retirementTotal +
      year.portfolioAssets.realEstateTotal +
      year.portfolioAssets.businessTotal +
      year.portfolioAssets.lifeInsuranceTotal;
  }

  return years;
}

// ── Wrapper: projection result with named death-event refs ───────────────────

/**
 * The result of a projection run, with optional named references to the
 * first- and second-death event years pulled out for convenient downstream
 * access (e.g. estate report sections).
 *
 * Both event refs are `undefined` when no death falls inside the plan window.
 * `years` is always the full projection array regardless.
 */
export interface ProjectionResult {
  years: ProjectionYear[];
  firstDeathEvent?: EstateTaxResult;
  secondDeathEvent?: EstateTaxResult;
  /** Hypothetical estate tax computed against the BoY-of-planStartYear
   * snapshot (advisor-entered balances, before any growth/income runs).
   * Used by the Estate Tax report's "Today" view so it agrees with the
   * Balance Sheet's "Today" mode. The per-year `hypotheticalEstateTax`
   * on each ProjectionYear is EoY and remains the source for future-year
   * snapshots. */
  todayHypotheticalEstateTax: HypotheticalEstateTax;
  /** Per-year per-grantor gift-tax ledger walking plan years from start to
   * end. Seeded from `planSettings.priorTaxableGifts`. Asset gift values use
   * a $0 fallback in Phase 1 (matches `computeAdjustedTaxableGifts`). */
  giftLedger: GiftLedgerYear[];
}

/**
 * Compute the "as of today" hypothetical estate tax — both grantors die at
 * the start of planStartYear, before any projected growth or income. The
 * inputs mirror the BoY initialization inside `runProjection` so values
 * align with the advisor-entered balances surfaced on the Balance Sheet's
 * Today view.
 */
function computeTodayHypotheticalEstateTax(
  data: ClientData,
): HypotheticalEstateTax {
  const planStartYear = data.planSettings.planStartYear;

  const accountBalances: Record<string, number> = {};
  const basisMap: Record<string, number> = {};
  for (const acct of data.accounts) {
    accountBalances[acct.id] = acct.value;
    basisMap[acct.id] = acct.basis;
  }

  // Match the runProjection liability-init: each balance is the schedule's
  // BoY balance at planStartYear, falling back to the raw balance when the
  // liability has no schedule.
  const liabilitySchedules = buildLiabilitySchedules(data.liabilities);
  const liabilities = data.liabilities.map((l) => {
    const sched = liabilitySchedules.get(l.id);
    const boyBalance = sched
      ? scheduleBoYBalance(sched, planStartYear)
      : l.balance;
    return { ...l, balance: boyBalance };
  });

  const filingStatus = (data.client.filingStatus ?? "single") as FilingStatus;
  const isMarried =
    filingStatus === "married_joint" || filingStatus === "married_separate";

  return computeHypotheticalEstateTax({
    year: planStartYear,
    isMarried,
    accounts: data.accounts,
    accountBalances,
    basisMap,
    incomes: data.incomes,
    liabilities,
    familyMembers: data.familyMembers ?? [],
    externalBeneficiaries: data.externalBeneficiaries ?? [],
    entities: data.entities ?? [],
    wills: data.wills ?? [],
    planSettings: data.planSettings,
    gifts: data.gifts ?? [],
    giftEvents: data.giftEvents,
    annualExclusionsByYear: buildAnnualExclusionsMap(data.taxYearRows ?? []),
  });
}

/**
 * Thin wrapper around `runProjection` that also extracts the first- and
 * second-death `EstateTaxResult` objects into named top-level fields.
 *
 * Zero breaking changes — existing callers of `runProjection` are unaffected.
 */
export function runProjectionWithEvents(
  data: ClientData,
  options?: ProjectionOptions,
): ProjectionResult {
  const years = runProjection(data, options);
  const firstIdx = years.findIndex((y) => y.estateTax?.deathOrder === 1);
  const secondIdx = years.findIndex((y) => y.estateTax?.deathOrder === 2);
  const annualExclusionsByYear = buildAnnualExclusionsMap(data.taxYearRows ?? []);
  const giftLedger = computeGiftLedger({
    planStartYear: data.planSettings.planStartYear,
    planEndYear: data.planSettings.planEndYear,
    hasSpouse: data.client.spouseDob != null,
    priorTaxableGifts: data.planSettings.priorTaxableGifts ?? { client: 0, spouse: 0 },
    gifts: data.gifts ?? [],
    giftEvents: data.giftEvents ?? [],
    externalBeneficiaryKindById: new Map(
      (data.externalBeneficiaries ?? [])
        .filter((e) => e.kind != null)
        .map((e) => [e.id, e.kind!] as const),
    ),
    annualExclusionsByYear,
    taxInflationRate: data.planSettings.taxInflationRate ?? data.planSettings.inflationRate ?? 0,
    accountValueAtYear: () => 0,
  });
  return {
    years,
    firstDeathEvent: firstIdx >= 0 ? years[firstIdx].estateTax! : undefined,
    secondDeathEvent: secondIdx >= 0 ? years[secondIdx].estateTax! : undefined,
    todayHypotheticalEstateTax: computeTodayHypotheticalEstateTax(data),
    giftLedger,
  };
}
