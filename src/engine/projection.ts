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
  EstateTaxResult,
  HypotheticalEstateTax,
} from "./types";
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
import { applyContributionLimits, computeMaxContribution, resolveAgeInYear } from "./contribution-limits";
import { executeWithdrawals, planSupplementalWithdrawal } from "./withdrawal";
import { calculateRMD } from "./rmd";
import { applyTransfers } from "./transfers";
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
    if (acct.subType === "roth_ira" || acct.subType === "roth_401k") return 4;
    // traditional_ira, 401k, 529, deferred, other → tax-deferred bucket
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
        rmdAmount: 0,
        fees: 0,
        endingValue: beginningValue,
        entries: [],
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
          rmdAmount: 0,
          fees: 0,
          endingValue: currentBalance,
          entries: [],
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

    // 5. Compute taxable income total and per-category tax detail.
    const taxableIncome =
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
      if (year < inc.startYear || year > inc.endYear) continue;
      if (inc.ownerEntityId != null && !isGrantorEntity(inc.ownerEntityId)) continue;
      if (inc.type === "social_security") continue;
      const inflateFrom = inc.inflationStartYear ?? inc.startYear;
      const amount = inc.annualAmount * Math.pow(1 + inc.growthRate, year - inflateFrom);
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
    // Add RMDs to ordinary income
    if (householdRmdIncome > 0) {
      taxDetail.ordinaryIncome += householdRmdIncome;
    }
    if (grantorRmdTaxable > 0) {
      taxDetail.ordinaryIncome += grantorRmdTaxable;
    }

    // Add transfer and sale income to tax detail
    taxDetail.ordinaryIncome += transferResult.taxableOrdinaryIncome;
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

      trustPassResult = applyTrustAnnualPass({
        year,
        nonGrantorTrusts,
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
    for (const inc of currentIncomes) {
      if (inc.type !== "salary") continue;
      if (inc.ownerEntityId != null) continue;
      if (year < inc.startYear || year > inc.endYear) continue;
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
      if (year < rule.startYear || year > rule.endYear) continue;
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
        if (year < exp.startYear || year > exp.endYear) continue;
        const inflateFrom = exp.inflationStartYear ?? exp.startYear;
        const amount = exp.annualAmount * Math.pow(1 + exp.growthRate, year - inflateFrom);
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
        if (year < rule.startYear || year > rule.endYear) continue;
        const acct = data.accounts.find((a) => a.id === rule.accountId);
        if (!acct) continue;
        const subType = acct.subType ?? "";
        if (subType !== "traditional_ira" && subType !== "401k") continue;
        if (controllingEntity(acct) != null && !isGrantorEntity(controllingEntity(acct)!)) continue;
        aboveLineBySource[rule.id] = { label: acct.name, amount: rule.annualAmount };
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
      if (year < inc.startYear || year > inc.endYear) continue;
      if (inc.ownerEntityId != null && !isGrantorEntity(inc.ownerEntityId)) continue;
      let amount: number;
      if (inc.scheduleOverrides) {
        amount = inc.scheduleOverrides[year] ?? 0;
      } else {
        const inflateFrom = inc.inflationStartYear ?? inc.startYear;
        amount = inc.annualAmount * Math.pow(1 + inc.growthRate, year - inflateFrom);
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
      if (year < inc.startYear || year > inc.endYear) continue;
      const resolved = income.bySource[inc.id] ?? grantorIncome.bySource[inc.id];
      let amount: number;
      if (resolved != null) {
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
        amount = inc.annualAmount * Math.pow(1 + inc.growthRate, year - inflateFrom);
      }
      creditCash(resolveCashAccount(inc.ownerEntityId, inc.cashAccountId), amount, {
        category: "income",
        label: `Income: ${inc.name}`,
        sourceId: inc.id,
      });
    }

    // 7. Route each expense as an outflow from its cash account.
    for (const exp of allExpenses) {
      if (year < exp.startYear || year > exp.endYear) continue;
      const inflateFrom = exp.inflationStartYear ?? exp.startYear;
      const amount = exp.annualAmount * Math.pow(1 + exp.growthRate, year - inflateFrom);
      creditCash(resolveCashAccount(exp.ownerEntityId, exp.cashAccountId), -amount, {
        category: "expense",
        label: `Expense: ${exp.name}`,
        sourceId: exp.id,
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
          undefined,
          salaryByRuleId,
          cappedByRuleId
        )
      : applySavingsRules(
          data.savingsRules,
          year,
          income.salaries,
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
      if (year < rule.startYear || year > rule.endYear) continue;
      const acct = data.accounts.find((a) => a.id === rule.accountId);
      const ownerSalary = acct ? (salaryByRuleId[rule.id] ?? 0) : 0;
      const match = computeEmployerMatch(rule, ownerSalary);
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
    for (const [acctId, delta] of Object.entries(cashDelta)) {
      accountBalances[acctId] = (accountBalances[acctId] ?? 0) + delta;
      if (accountLedgers[acctId]) {
        if (delta >= 0) {
          accountLedgers[acctId].contributions += delta;
          accountLedgers[acctId].endingValue += delta;
        } else {
          accountLedgers[acctId].distributions += -delta;
          accountLedgers[acctId].endingValue += delta;
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
    let withdrawalTax = 0;

    // 12a. Cash drawdown reporting — when this year's net flow ate into a
    // prior-year surplus sitting in household checking, attribute the consumed
    // portion as a withdrawal from cash. Reporting-only; balance movement was
    // already captured by the individual entries.
    if (hasChecking) {
      const checkingId = defaultChecking!.id;
      const endingAfterDeltas = accountBalances[checkingId] ?? 0;
      const consumed = checkingBalanceBeforeDeltas - endingAfterDeltas;
      const cashDrawdown = Math.max(
        0,
        Math.min(Math.max(0, checkingBalanceBeforeDeltas), consumed)
      );
      if (cashDrawdown > 0) {
        withdrawals.byAccount[checkingId] = cashDrawdown;
        withdrawals.total += cashDrawdown;
      }
    }

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

      for (let iter = 0; iter < MAX_ITER; iter++) {
        if (Math.abs(checkingAfterTax) <= TOLERANCE) break;
        // Initial-surplus / final-surplus case with no draws-to-undo: nothing to do.
        // Without this, the loop spins MAX_ITER times on every non-deficit year and
        // emits a spurious convergenceWarning at the last iteration.
        if (checkingAfterTax > 0 && cumulativeShortfall === 0) break;

        if (checkingAfterTax < 0) {
          cumulativeShortfall += -checkingAfterTax;
        } else if (cumulativeShortfall > 0) {
          cumulativeShortfall = Math.max(0, cumulativeShortfall - checkingAfterTax);
        }

        supplementalPlan = planSupplementalWithdrawal({
          shortfall: cumulativeShortfall,
          strategy: effectiveWithdrawalStrategy,
          householdBalances: householdWithdrawBalances,
          basisMap,
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

      for (const draw of supplementalPlan.draws) {
        if (draw.amount <= 0) continue;
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
      }

      if (supplementalPlan.total > 0) {
        accountBalances[checkingId] += supplementalPlan.total;
        if (accountLedgers[checkingId]) {
          accountLedgers[checkingId].contributions += supplementalPlan.total;
          accountLedgers[checkingId].endingValue += supplementalPlan.total;
          accountLedgers[checkingId].entries.push({
            category: "withdrawal",
            label: "Withdrawal to cover shortfall",
            amount: supplementalPlan.total,
          });
        }
      }

      const taxAndPenalty = finalTaxes + supplementalEarlyPenalty;
      withdrawalTax = supplementalEarlyPenalty;
      if (taxAndPenalty !== 0) {
        accountBalances[checkingId] -= taxAndPenalty;
        if (accountLedgers[checkingId]) {
          accountLedgers[checkingId].distributions += taxAndPenalty;
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
      }
    } else {
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

        // Track the liquidation as a real withdrawal in the year's totals so
        // cash-flow drill-down attributes the cap-gain-bearing draw to the
        // entity's account. Mirrors household gap-fill convention.
        withdrawals.byAccount[acctId] = (withdrawals.byAccount[acctId] ?? 0) + amount;
        withdrawals.total += amount;

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
          accountLedgers[checkingId].endingValue += amount;
          accountLedgers[checkingId].entries.push({
            category: "withdrawal",
            label: "Refill from entity liquidation",
            amount,
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
    // its entity is flagged to roll into portfolio assets.
    const portfolioAssets = {
      taxable: {} as Record<string, number>,
      cash: {} as Record<string, number>,
      retirement: {} as Record<string, number>,
      realEstate: {} as Record<string, number>,
      business: {} as Record<string, number>,
      lifeInsurance: {} as Record<string, number>,
      taxableTotal: 0,
      cashTotal: 0,
      retirementTotal: 0,
      realEstateTotal: 0,
      businessTotal: 0,
      lifeInsuranceTotal: 0,
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
      // Pro-rate value into the portfolio: household share rolls in directly,
      // each entity owner's share rolls in only when its entity is flagged
      // includeInPortfolio. Non-portfolio entity shares are excluded.
      // T7: use year-aware helper so gift events that transfer ownership to an
      // entity are reflected in the correct year's balance-sheet snapshot.
      // T9: also use year-aware owners for the entity-side loop so includeInPortfolio
      // entities that receive ownership via a gift are counted starting the gift year.
      const portfolioYearOwners = ownersForYear(acct, data.giftEvents, year, planSettings.planStartYear);
      let inPortfolioFraction = portfolioYearOwners
        .filter((o) => o.kind === "family_member")
        .reduce((s, o) => s + o.percent, 0);
      for (const owner of portfolioYearOwners) {
        if (owner.kind !== "entity") continue;
        const entity = entityMap[owner.entityId];
        if (entity?.includeInPortfolio) inPortfolioFraction += owner.percent;
      }
      if (inPortfolioFraction <= 0) continue;
      const inPortfolioVal = val * inPortfolioFraction;
      const key = categoryToKey[acct.category] ?? "taxable";
      portfolioAssets[key][acct.id] = inPortfolioVal;
      const totalKey = `${key}Total` as keyof typeof portfolioAssets;
      (portfolioAssets[totalKey] as number) += inPortfolioVal;
    }
    portfolioAssets.total =
      portfolioAssets.taxableTotal +
      portfolioAssets.cashTotal +
      portfolioAssets.retirementTotal +
      portfolioAssets.realEstateTotal +
      portfolioAssets.businessTotal +
      portfolioAssets.lifeInsuranceTotal;

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
      other: expenseBreakdown.other + techniqueExpenses,
      insurance: expenseBreakdown.insurance,
      realEstate: householdSyntheticExpenseTotal,
      taxes: totalTaxes,
      total:
        expenseBreakdown.living +
        expenseBreakdown.other +
        expenseBreakdown.insurance +
        householdSyntheticExpenseTotal +
        liabResult.totalPayment +
        totalTaxes +
        techniqueExpenses,
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

    const totalIncome = income.total + householdRmdIncome;
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

    years.push({
      year,
      ages,
      income,
      ...(income.socialSecurityDetail ? { socialSecurityDetail: income.socialSecurityDetail } : {}),
      taxDetail: finalTaxDetail,
      taxResult: finalTaxResult,
      charityCarryforward,
      deductionBreakdown: deductionBreakdownResult,
      withdrawals,
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
  return {
    years,
    firstDeathEvent: firstIdx >= 0 ? years[firstIdx].estateTax! : undefined,
    secondDeathEvent: secondIdx >= 0 ? years[secondIdx].estateTax! : undefined,
    todayHypotheticalEstateTax: computeTodayHypotheticalEstateTax(data),
  };
}
