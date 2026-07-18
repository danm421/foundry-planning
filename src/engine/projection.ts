import type {
  AccountFlowOverride,
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
  DeathTransfer,
  HypotheticalEstateTax,
  LifeInsurancePayout,
  MedicareCoverage,
  MedicareYearDetail,
  IrmaaTier,
  RothConversion,
  EducationGoalYear,
} from "./types";
import { computeMedicareYear } from "./medicare";
import { resolveResidenceState } from "./relocation";
import {
  computeBusinessAccountCashFlow,
  computeEntityCashFlow,
  type BusinessAccountMetadata,
  type EntityMetadata,
} from "./entity-cashflow";
import { computeBusinessYearFlow } from "./business/year-flow";
import { accrueLockedEntityShare } from "./locked-shares";
import { computeFamilyAccountShares } from "./family-cashflow";
import { computeGiftLedger, type GiftLedgerYear } from "./gift-ledger";
import { computeIncome } from "./income";
import { expandLinkedIncomes } from "./linked-income";
import { computeExpenses } from "./expenses";
import { computeLiabilities } from "./liabilities";
import { isHeldFlatLiability } from "./liability-kind";
import {
  buildLiabilitySchedule,
  buildLiabilitySchedules,
  scheduleBoYBalance,
  type LiabilityScheduleMap,
} from "./liability-schedules";
import { createTaxResolver } from "../lib/tax/resolver";
import type { TaxYearParameters, FilingStatus } from "../lib/tax/types";
import {
  buildAnnualExclusionMap,
  type AnnualExclusionRow,
} from "../lib/gifts/resolve-annual-exclusion";
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
import { applyContributionLimits, computeIraLimit, computeMaxContribution, resolveAgeInYear } from "./contribution-limits";
import { computeRoth529Rollover } from "./education/roth-rollover";
import { executeWithdrawals, planSupplementalWithdrawal, categorizeDraw, supplementalDrawSources, type SupplementalDraw } from "./withdrawal";
import { computeEducationDraw } from "./education/education-funding";
import { calculateRMD } from "./rmd";
import { applyTransfers, type TransfersResult } from "./transfers";
import { applyReinvestments } from "./reinvestments";
import { applyRothConversions } from "./roth-conversions";
import { applyMarketShock } from "./market-shock";
import {
  applyAssetSales,
  applyAssetPurchases,
  applyBusinessSales,
  _resetSyntheticIdCounter,
} from "./asset-transactions";
import type { BusinessSalesResult } from "./asset-transactions";
import { createEquityState, computeEquityYear } from "./equity/tax-events";
import { applyEquityYear } from "./equity/apply";
import { remainingGrantValue } from "./equity/valuation";
import type { StockOptionPlan } from "./equity/types";
import {
  computeFirstDeathYear,
  computeFinalDeathYear,
  identifyDeceased,
  identifyFinalDeceased,
  effectiveFilingStatus,
  isSpouseLifeExpectancyDefaulted,
  applyFirstDeath,
  applyFinalDeath,
} from "./death-event";
import {
  computeHypotheticalEstateTax,
  computeAnchoredHypotheticalEstateTax,
  emptyHypotheticalEstateTax,
} from "./what-if/hypothetical-estate-tax";
import { calcSeca, calcSeAdditionalMedicare } from "../lib/tax/fica";
import { resolveCashValueForYear } from "./life-insurance-schedule";
import { computeTermEndYear } from "./life-insurance-expiry";
import { computePortfolioSnapshot } from "./portfolio-snapshot";
import { applyTrustAnnualPass, type NonGrantorTrustInput } from "./trust-tax/index";
import {
  computeAnnualUnitrustPayment,
  computeAnnualAnnuityPayment,
  computeCltRecapture,
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
  LEGACY_FM_CLIENT,
  LEGACY_FM_SPOUSE,
} from "./ownership";
import {
  resolveEntityFlowAmount,
  computeBusinessEntityNetIncome,
  resolveDistributionPercent,
} from "./entity-flows";
import { type CharityBucket } from "./charitable-deduction";
import {
  emptyCharityCarryforward,
  type CharityCarryforward,
  type EntityFlowOverride,
} from "./types";
import { computeTaxForYear, type YearTaxInput } from "./year-tax";
import { diffEquityTaxImpact, type EquityTaxImpact } from "./equity/tax-impact";
import {
  buildNoteReceivableSchedules,
  computeNotesReceivable,
  type NoteScheduleMap,
  type NoteScheduleRow,
} from "./notes-receivable";

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
// (real estate, business, life insurance, stock_options). Shared by household and
// entity-scoped withdrawal strategies; callers layer on their own ownership /
// default-checking exclusions before consulting it.
function categoryWithdrawalPriority(acct: Account): number | null {
  if (acct.category === "cash") return 1;
  if (acct.category === "taxable") return 2;
  if (acct.category === "retirement") {
    if (acct.subType === "roth_ira") return 4;
    // traditional_ira, 401k, 403b, 529, deferred, other → tax-deferred bucket
    return 3;
  }
  if (acct.category === "notes_receivable") return null; // notes amortize themselves
  if (acct.category === "stock_options") return null; // illiquid grants — not a drawdown source
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

/** Insert just-paid-out life-insurance proceeds accounts into the effective
 *  withdrawal strategy. The strategy is snapshotted at projection start from
 *  `data.accounts`, where these accounts were still `life_insurance` (no
 *  withdrawal priority via `categoryWithdrawalPriority`). Without this they are
 *  never drawn, so retirement assets liquidate ahead of available proceeds.
 *  Proceeds land in the taxable tier: strictly after every existing cash /
 *  taxable account, strictly before retirement. Mutates `strategy` in place;
 *  skips ids already present (idempotent across re-entry).
 *
 *  Correctness depends on an invariant enforced in `life-insurance-payout.ts`:
 *  the payout transform produces a `category: "taxable"` account whose id is
 *  unchanged from the original policy. The taxable-tier placement assumes that. */
export function appendProceedsToWithdrawalStrategy(
  strategy: WithdrawalPriority[],
  proceedsAccountIds: string[],
  accounts: ReadonlyArray<Pick<Account, "id" | "category">>,
  deathYear: number,
  planEndYear: number,
): void {
  if (proceedsAccountIds.length === 0) return;
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  // Highest priorityOrder among cash/taxable entries already in the strategy;
  // baseline 1 (the cash tier) when none exist.
  let maxLiquidPriority = 1;
  for (const entry of strategy) {
    const acct = accountById.get(entry.accountId);
    if (acct && (acct.category === "cash" || acct.category === "taxable")) {
      maxLiquidPriority = Math.max(maxLiquidPriority, entry.priorityOrder);
    }
  }
  // +0.5 → sorts strictly after existing liquid accounts, strictly before
  // retirement (priorityOrder 3 in the default strategy).
  const proceedsPriority = maxLiquidPriority + 0.5;
  for (const accountId of proceedsAccountIds) {
    if (strategy.some((s) => s.accountId === accountId)) continue;
    strategy.push({
      accountId,
      priorityOrder: proceedsPriority,
      startYear: deathYear,
      endYear: planEndYear,
    });
  }
}

// Build a dense per-year §2503(b) annual gift exclusion lookup from the loaded
// tax-year rows. Seeded years keep their exact values; years past the latest
// seeded row are forward-projected from it (audit F2 — without projection any
// gift past the last seeded year silently got a $0 exclusion). pg-numeric
// columns can arrive as strings at the engine boundary, so coerce once here.
function buildAnnualExclusionsMap(
  rows: AnnualExclusionRow[],
  planSettings: PlanSettings,
): Record<number, number> {
  return buildAnnualExclusionMap(
    rows,
    planSettings.planStartYear,
    planSettings.planEndYear,
    planSettings.taxInflationRate ?? planSettings.inflationRate ?? 0,
  );
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
  /**
   * Skip the per-year hypothetical estate-tax computation (a reporting-only
   * field — the Balance Sheet "Today" view). Set by the Monte Carlo trial path,
   * which runs `runProjection` 1000× and never reads it; computing it is ~80% of
   * MC compute (7 structuredClones + a death pass, every year). When set, each
   * year's `hypotheticalEstateTax` is a zeroed sentinel. Left unset, behavior is
   * byte-identical to before. NEVER set on the report/balance-sheet path.
   */
  skipHypotheticalEstateTax?: boolean;
}

/** Fold life-insurance death benefits into a year's displayed income so they
 *  surface as a cash-flow inflow — the "Other Inflows" band reads income.other,
 *  the report table/drill reads income.bySource. Keeps the P&L scalars
 *  (income.total, totalIncome, netCashFlow) in sync since the death event
 *  fires after the year is assembled. §101(a): proceeds are income-tax-free,
 *  so they touch income totals but never taxDetail. */
function foldLifeInsurancePayoutsIntoIncome(
  year: ProjectionYear,
  payouts: LifeInsurancePayout[],
): void {
  if (payouts.length === 0) return;
  let total = 0;
  for (const p of payouts) {
    total += p.faceValue;
    const key = `life-insurance-proceeds:${p.policyId}`;
    year.income.bySource[key] = (year.income.bySource[key] ?? 0) + p.faceValue;
  }
  year.income.other += total;
  year.income.total += total;
  year.totalIncome += total;
  year.netCashFlow += total;
}

export function runProjection(data: ClientData, options?: ProjectionOptions): ProjectionYear[] {
  const { client, planSettings } = data;
  const years: ProjectionYear[] = [];

  // Future-activated accounts: an account with a resolved `activationYear`
  // does not exist in the projection before that year (no seed, no ledger, no
  // contributions), then joins the working set at its entered `value` in the
  // activation year (see the top-of-year join below). Null/undefined ⇒ active
  // from plan start, so this is a provable no-op for every existing plan.
  const isPreActivation = (acct: Account, atYear: number): boolean =>
    acct.activationYear != null && acct.activationYear > atYear;

  // Year-keyed MAGI history for IRMAA's 2-year lookback. Populated each year
  // after the converged tax calc. The medicare block reads `year - 2` from
  // this map; for the first two projection years (or when an explicit override
  // exists) it cold-starts from `coverage.priorYearMagi`.
  const magiHistory = new Map<number, number>();

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

  // Stress test "Higher inflation": pin living-expense growth at the override
  // rate. Scoped to `type === "living"` on purpose — insurance/other expenses,
  // incomes, savings, and tax-bracket indexing keep the plan's inflation rate.
  // One-time pre-pass: only reaches expenses present at entry, so a future
  // synthetic `type: "living"` expense injected mid-loop (today they're all
  // "other") must be routed through this override too.
  if (planSettings.livingExpenseInflationOverride != null) {
    const rate = planSettings.livingExpenseInflationOverride;
    data = {
      ...data,
      expenses: data.expenses.map((e) =>
        e.type === "living" ? { ...e, growthRate: rate } : e,
      ),
    };
  }

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

  /**
   * Was each split-interest trust a GRANTOR trust in its own inception year?
   * Snapshotted once, from the immutable `data.entities`, before any death-event
   * grantor-succession flip can occur.
   *
   * ⚠️ Do NOT re-derive this as `effectiveIsGrantor(id, si.inceptionYear)`.
   * That predicate reads `entityMap[id].isGrantor` — i.e. "as of NOW" — and only
   * its grantorStatusEndYear comparison consumes the year argument. Grantor
   * succession reassigns currentEntities and calls rebuildEntityMap() with
   * isGrantor:false at the grantor's death, so in the death year — exactly when
   * §170(f)(2)(B) recapture must fire — the naive gate would return false and
   * recapture would silently never fire. (audit F5)
   *
   * Also correct when inceptionYear predates planStartYear (a pre-existing CLT),
   * where no runtime observation of the deduction is possible at all.
   *
   * Gates BOTH the CLT inception deduction and its recapture, so the invariant
   * "recapture iff deducted" holds by construction.
   */
  const grantorAtInception = new Map<string, boolean>();
  for (const e of data.entities ?? []) {
    if (!e.splitInterest) continue;
    grantorAtInception.set(
      e.id,
      e.isGrantor === true &&
        (e.grantorStatusEndYear == null ||
          e.splitInterest.inceptionYear <= e.grantorStatusEndYear),
    );
  }

  /**
   * Year-aware "is this entity currently a grantor trust" predicate. A trust
   * is "effectively grantor" only when {@link EntitySummary.isGrantor} is
   * still true AND the grantor-status window has not elapsed
   * (`grantorStatusEndYear == null` or `currentYear <= grantorStatusEndYear`).
   * Grantor-death precedence is automatic: `applyGrantorSuccession` flips
   * `isGrantor` to false at the death event, so the first guard handles it
   * without reading death years here. Implements the
   * `min(grantorStatusEndYear, grantorDeathYear)` precedence from the IDGT
   * spec.
   */
  const effectiveIsGrantor = (
    entityId: string | undefined,
    currentYear: number
  ): boolean => {
    if (entityId == null) return false;
    const e = entityMap[entityId];
    if (e?.isGrantor !== true) return false;
    if (e.grantorStatusEndYear != null && currentYear > e.grantorStatusEndYear) {
      return false;
    }
    return true;
  };

  /**
   * IRC §664(c)(1): a charitable remainder trust is exempt from income tax for
   * its entire life — internal income accumulates untaxed and only the
   * annuity/unitrust payment is taxed, to the recipient. No year parameter:
   * the exemption never turns on or off.
   *
   * ⚠️ This is NOT expressible as "not a grantor trust". Every tax fork in this
   * file is binary — `if (effectiveIsGrantor(x)) → household 1040; else → trust
   * 1041` — so routing a CRT down the `else` branch lands it in the
   * compressed-bracket 1041 pass, which IS the bug (audit F1). Always test
   * isTaxExemptTrust BEFORE the grantor fork, never instead of it.
   *
   * Keyed on trustSubType alone (not `&& splitInterest`): a malformed CRT with
   * no splitInterest snapshot still must not be taxed as an ordinary trust.
   *
   * Ten call sites, against 14 `effectiveIsGrantor` call sites — the two are NOT
   * in 1:1 correspondence, so "every grantor fork has a CRT guard" is the wrong
   * mental model. The sites are:
   *   - buildNonGrantorTrusts .............. keeps the CRT out of the 1041 pass
   *   - carry-in gap-fill gains ............ prior-year entity liquidation
   *   - grantorIncome filter ............... CRT-owned income rows
   *   - growth pass: grantorShare .......... realization → householdLikeShare
   *   - growth pass: grantorTrustIncome .... distribution sizing (not tax)
   *   - growth pass: non-grantor push ...... realization → 1041 pass
   *   - entity RMD ......................... CRT-owned retirement account
   *   - household-1040 trust income rows ... CRT-owned income rows
   *   - sale-gain exemption netting ........ SELECTS the exempt share (inverted)
   *   - sale gains → 1041 hand-off ......... keeps CRT gains out of that pass
   *
   * Eight of the ten are individually mutation-killed by
   * `crt-664c-exemption.test.ts`. The two growth-pass sites marked above
   * (grantorTrustIncome, non-grantor push) are defense-in-depth: disabling
   * either ALONE is behaviorally inert (verified byte-identical projection
   * output), because the only consumer of what they feed already filters on the
   * entity list buildNonGrantorTrusts governs. Do not read their lack of
   * coverage as "untested" — read it as "currently unreachable"; they exist so
   * that relaxing buildNonGrantorTrusts later cannot silently re-tax a CRT.
   */
  const isTaxExemptTrust = (entityId: string | undefined): boolean =>
    entityId != null && entityMap[entityId]?.trustSubType === "crt";

  // Effective withdrawal strategy. If the user hasn't configured anything, fall back
  // to a tax-efficient default: Cash → Taxable → Tax-Deferred → Roth. Illiquid
  // categories (real estate, business, life insurance) and default-checking accounts
  // are skipped. The household checking is always the target, never a source.
  // Copy the configured strategy (or build the default) into a fresh array we
  // own. Death events append life-insurance proceeds accounts to it mid-run
  // (see appendProceedsToWithdrawalStrategy); we must not mutate the caller's
  // `data.withdrawalStrategy`.
  const effectiveWithdrawalStrategy: WithdrawalPriority[] =
    data.withdrawalStrategy.length > 0
      ? [...data.withdrawalStrategy]
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
          e.isGrantor === false &&
          // §664(c): a CRT is exempt — it must never enter the 1041 pass. (F1)
          !isTaxExemptTrust(e.id)
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
    if (isPreActivation(acct, planSettings.planStartYear)) continue;
    accountBalances[acct.id] = acct.value;
  }

  // Cumulative 529 → Roth rollovers per source account, across all years.
  // SECURE 2.0 §126 caps lifetime rollovers per beneficiary/account at
  // $35,000; this tracker persists across projection years so the pass can
  // enforce that cap over the whole horizon.
  const rolled529ByAccount: Record<string, number> = {};

  // Per-year end-of-year balance snapshots. Keyed by year so death-event
  // accountValueAtYear callbacks can return the gift-year balance instead of
  // always the death-year balance. Populated just before years.push().
  const yearEndAccountBalances = new Map<number, Record<string, number>>();

  // Basis tracking for transfers and sales
  const basisMap: Record<string, number> = {};
  for (const acct of data.accounts) {
    if (isPreActivation(acct, planSettings.planStartYear)) continue;
    basisMap[acct.id] = acct.basis;
  }

  // Per-year, per-account unspent basisIncrease pool. Reset at top of each
  // projection year; drained as taxable-account withdrawals/transfers consume
  // current-year-recognized investment income. See spec
  // 2026-05-11-fresh-basis-withdrawal-ordering-design.
  const freshBasisMap: Record<string, number> = {};

  // Roth value tracking for 401k/403b accounts. Mirrors basisMap shape so
  // every account has an entry (0 for non-401k/403b). Grows alongside the
  // account each year and decrements pro-rata on withdrawals / Roth
  // conversions out.
  const rothValueMap: Record<string, number> = {};
  for (const acct of data.accounts) {
    if (isPreActivation(acct, planSettings.planStartYear)) continue;
    rothValueMap[acct.id] = acct.rothValue ?? 0;
  }

  // Mutable accounts list — techniques can add/remove accounts. Pre-activation
  // accounts are excluded here and join at their activation year (see the
  // top-of-year activation join inside the loop below).
  let workingAccounts = data.accounts.filter(
    (a) => !isPreActivation(a, planSettings.planStartYear),
  );

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

  // Notes receivable — installment-sale promissory notes held by the household
  // (or, for trust-side bookkeeping, with `linkedTrustEntityId` set so the
  // payor's cash account is drained mirror-image of the household inflow).
  // Schedules are built once at projection start (mirrors liabilitySchedules)
  // and consulted by the per-year notes-receivable compute step.
  const notesReceivable = data.notesReceivable ?? [];
  const noteSchedules: NoteScheduleMap = buildNoteReceivableSchedules(notesReceivable);
  // F16: per-note, per-year ending-balance lookup — avoids a .find() per note
  // per year in the projection loop. Built once from the schedules above.
  const noteScheduleByYear = new Map<string, Map<number, NoteScheduleRow>>();
  for (const [noteId, sched] of noteSchedules) {
    const byYear = new Map<number, NoteScheduleRow>();
    // First-wins to match the prior .find() semantics on any duplicate-year rows.
    for (const r of sched) if (!byYear.has(r.year)) byYear.set(r.year, r);
    noteScheduleByYear.set(noteId, byYear);
  }

  const clientBirthYear = parseInt(client.dateOfBirth.slice(0, 4), 10);
  const spouseBirthYear = client.spouseDob
    ? parseInt(client.spouseDob.slice(0, 4), 10)
    : undefined;

  // Household principal FM ids — used to route account ownership checks that
  // previously relied on acct.owner === "client" / "spouse".
  const clientFmId = (data.familyMembers ?? []).find((fm) => fm.role === "client")?.id ?? null;
  const spouseFmId = (data.familyMembers ?? []).find((fm) => fm.role === "spouse")?.id ?? null;
  // Household principals for portfolio-snapshot scoping. The legacy sentinel
  // ids always denote the principal client/spouse; real FamilyMember ids add
  // to — never replace — them, so legacy, modern, and mixed ownership data all
  // resolve correctly.
  const principalFmIds = new Set<string>([LEGACY_FM_CLIENT, LEGACY_FM_SPOUSE]);
  if (clientFmId) principalFmIds.add(clientFmId);
  if (spouseFmId) principalFmIds.add(spouseFmId);

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

  // The real projected first death, frozen at year F. Populated in the
  // first-death block below; null until then. Once set, every subsequent year's
  // hypothetical anchors to this frozen event (survivor-dies-at-N) instead of
  // re-running the first death against post-death (drained) state.
  let realFirstDeath:
    | { decedent: "client" | "spouse"; estateTax: EstateTaxResult; transfers: DeathTransfer[]; dsueGenerated: number }
    | null = null;

  let currentIncomes: Income[] = expandLinkedIncomes(data.incomes, {
    accountById,
    giftEvents: data.giftEvents ?? [],
    assetTransactions: data.assetTransactions ?? [],
    planStartYear: planSettings.planStartYear,
    clientFmId,
    spouseFmId,
  });
  // Snapshot of the year's resolved `allExpenses` (data.expenses + synthetic
  // property-tax rows). Captured each iteration so the post-loop entity
  // cash-flow pass can read entity-tagged synthetic expenses.
  let lastAllExpenses: Expense[] = data.expenses;

  const annualExclusionsByYear = buildAnnualExclusionsMap(data.taxYearRows ?? [], planSettings);
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

  // Cross-year record of actual lead-interest payments made by each CLT,
  // ordered year-by-year from inception. Drained by the §170(f)(2)(B)
  // recapture pass when a grantor of a CLT dies mid-term — the PV of these
  // payments at the original §7520 rate is subtracted from the original
  // income-interest deduction to compute recapture as ordinary income on the
  // final 1040.
  const cltPaymentsByTrustId: Map<string, number[]> = new Map();

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

  // F16: hoist per-year asset-transaction partitions out of the loop — the
  // sell/buy split never changes year to year; applyAssetSales/Purchases still
  // filter by year internally, so behavior is identical.
  const allSales = (data.assetTransactions ?? []).filter(
    (t) => t.type === "sell" && t.enabled !== false,
  );
  const allPurchases = (data.assetTransactions ?? []).filter(
    (t) => t.type === "buy" && t.enabled !== false,
  );
  // Same hoist for reinvestments: the active set never changes year to year
  // (applyReinvestments still filters by year internally).
  const activeReinvestments = (data.reinvestments ?? []).filter(
    (r) => r.enabled !== false,
  );

  // F16: (entityId, year) → entity-flow override row; avoids a .find() per
  // entity per year in the projection loop.
  const entityFlowOverrideByKey = new Map<string, EntityFlowOverride>();
  for (const o of data.entityFlowOverrides ?? []) {
    // First-wins to match the prior .find() semantics on any duplicate keys.
    const key = `${o.entityId}:${o.year}`;
    if (!entityFlowOverrideByKey.has(key)) entityFlowOverrideByKey.set(key, o);
  }

  // Partition savings rules once (loop-invariant). Self-funding (analysis-only)
  // rules are handled by the per-year waterfall, NOT the normal checking-debit
  // path — they must never drive a supplemental withdrawal.
  const normalSavingsRules = data.savingsRules.filter((r) => !r.fundFromExpenseReduction);
  const selfFundingRules = data.savingsRules.filter((r) => r.fundFromExpenseReduction);

  // Equity compensation. Build the per-plan action timeline once (loop-
  // invariant); per-year vest/exercise/sell tax events are computed inside the
  // year loop. Opt-in: when `stockOptionPlans` is empty the whole equity phase
  // is a no-op, so plans without stock_options accounts are unaffected.
  const equityPlans: StockOptionPlan[] = data.stockOptionPlans ?? [];
  const equityState = createEquityState(equityPlans, planSettings.planStartYear);
  // Destination taxable-account id per plan, created lazily on first acquisition.
  const equityDestByPlan = new Map<string, string>();

  for (
    let year = planSettings.planStartYear;
    year <= planSettings.planEndYear;
    year++
  ) {
    // Activation-year join: a future account joins the working set at its
    // activation year, seeded at its entered value (windfall). The ledger-init
    // loop below picks it up automatically. Balance carries forward across
    // later years (workingAccounts is never rebuilt from data.accounts).
    for (const acct of data.accounts) {
      if (acct.activationYear === year && !workingAccounts.some((w) => w.id === acct.id)) {
        workingAccounts.push(acct);
        accountBalances[acct.id] = acct.value;
        basisMap[acct.id] = acct.basis;
        rothValueMap[acct.id] = acct.rothValue ?? 0;
      }
    }

    // Accounts not yet activated this year: no contributions/match may land on
    // them until they join. Empty set for every plan without future accounts.
    const notYetActive = new Set(
      data.accounts
        .filter((a) => a.activationYear != null && a.activationYear > year)
        .map((a) => a.id),
    );

    // Residence state can change mid-plan via relocation techniques. Override
    // only residenceState; a no-op (same reference) when there are no moves, so
    // existing plans are byte-for-byte unchanged.
    const planSettingsForYear: PlanSettings = data.relocations?.length
      ? {
          ...planSettings,
          residenceState: resolveResidenceState(
            planSettings.residenceState ?? null,
            data.relocations,
            year,
          ),
        }
      : planSettings;

    // Fresh-basis pool resets every year: prior-year reinvested income
    // ages into the legacy pool. Spec 2026-05-11.
    for (const key of Object.keys(freshBasisMap)) delete freshBasisMap[key];

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
      // §664(c): CRT gains are exempt — neither deferred to the household 1040
      // nor routed to the 1041 pass. Drop them outright. (F1)
      if (isTaxExemptTrust(g.entityId)) continue;
      if (effectiveIsGrantor(g.entityId, year)) {
        grantorCarryInCapGains += g.gain;
      } else {
        nonGrantorCarryInGains.push({ ownerEntityId: g.entityId, gain: g.gain });
      }
    }

    // 1. Compute income breakdowns. Household and grantor-trust streams are kept
    // separate because grantor income flows to the entity checking but is still
    // taxable at the household rate.
    //
    // Grantor BUSINESS entities (non-trust) are NOT in grantorIncome: their
    // K-1 incidence is computed by the Phase 3 block below from net income
    // (gross − entity expenses) via resolveEntityFlows, which is the only
    // path that respects schedule-mode flowMode overrides and matches the
    // entity-cashflow display. Including them here would double-count and
    // use raw inc.annualAmount (ignoring the schedule grid).
    const income = computeIncome(
      currentIncomes,
      year,
      client,
      // Exclude business-owned (ownerAccountId) rows from household totals.
      // Business income is taxed via the Phase 3 K-1 incidence block (which
      // adds the household share directly to taxDetail/taxableIncome) and
      // routed to household cash via the Phase 3 distribution sweep — so it
      // must not also contribute to income.total / income.bySource here, or
      // we double-count it in the household tax base and cashflow surplus.
      (inc) => inc.ownerEntityId == null && inc.ownerAccountId == null,
      {
        ssBenefitHaircut: planSettings.ssBenefitHaircut,
        disabilityEvent: planSettings.disabilityEvent,
      },
    );
    const grantorIncome = computeIncome(
      currentIncomes,
      year,
      client,
      (inc) => {
        if (inc.ownerEntityId == null) return false;
        // §664(c): CRT-owned income rows are exempt — never on the household
        // 1040. Cash still routes to the trust's checking via
        // resolveEntityFlowAmount, which does not consult grantorIncome. (F1)
        if (isTaxExemptTrust(inc.ownerEntityId)) return false;
        if (!effectiveIsGrantor(inc.ownerEntityId, year)) return false;
        return entityMap[inc.ownerEntityId]?.entityType === "trust";
      }
    );

    // 2. Household expenses (entity-owned expenses are paid by the entity).
    // Pass only real expenses — synthetic property-tax expenses (built later,
    // post-BoY transactions) are tracked separately in the realEstate bucket.
    const expenseBreakdown = computeExpenses(
      data.expenses,
      year,
      data.client,
      // Exclude business-owned (ownerAccountId) rows: those are netted against
      // business income inside the Phase 3 distribution sweep, not paid from
      // household cash. Including them here would inflate household
      // non-savings outflows and depress the cashflow surplus. Education goals
      // are funded via applyEducationFunding (dedicated draw + optional
      // out-of-pocket spill), never as a plain household expense.
      (exp) =>
        exp.ownerEntityId == null &&
        exp.ownerAccountId == null &&
        exp.type !== "education"
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
        // Cash basis ≡ value: cash flows never move basisMap, so reading it here
        // would stamp a stale BoY basis. Mirror the balance instead (see the EoY
        // stamp). Non-cash accounts keep their tracked cost basis.
        basisBoY: acct.category === "cash" ? beginningValue : (basisMap[acct.id] ?? acct.basis),
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

    // ── BoY: Business Sales ─────────────────────────────────────────────────
    // Selling a business cascades to liquidate every child account and
    // liability (accounts whose parentAccountId points at the business).
    // Runs before applyAssetSales so any account/liability the cascade fully
    // drains is already gone before direct account sales fire in the same
    // year.
    let businessSaleResult: BusinessSalesResult = {
      capitalGains: 0,
      capitalGainsByOwner: {},
      removedAccountIds: [],
      removedLiabilityIds: [],
      removedBusinessAccountIds: [],
      totalLiabilityPaydown: 0,
      breakdown: [],
      diagnostics: [],
    };
    if (data.assetTransactions && data.assetTransactions.length > 0) {
      const businessSales = data.assetTransactions.filter(
        (t) =>
          t.type === "sell" &&
          t.enabled !== false &&
          t.year === year &&
          t.businessAccountId,
      );
      if (businessSales.length > 0) {
        businessSaleResult = applyBusinessSales({
          sales: businessSales,
          accounts: workingAccounts,
          liabilities: currentLiabilities,
          accountBalances,
          basisMap,
          accountLedgers,
          year,
          defaultCheckingId: defaultChecking?.id ?? "",
        });

        if (businessSaleResult.removedAccountIds.length > 0) {
          const removed = new Set(businessSaleResult.removedAccountIds);
          workingAccounts = workingAccounts.filter((a) => !removed.has(a.id));
        }
        if (businessSaleResult.removedLiabilityIds.length > 0) {
          const removed = new Set(businessSaleResult.removedLiabilityIds);
          currentLiabilities = currentLiabilities.filter(
            (l) => !removed.has(l.id),
          );
        }
        // No entity removal needed — businesses are account rows; their
        // disposal is reflected in removedAccountIds above.
      }
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
      const sales = allSales;
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
          // Entity-owned asset sales with no explicit proceeds destination route
          // to the owning entity's own checking, not the household default.
          entityCheckingByEntityId,
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
      const purchases = allPurchases;
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
          // Held-flat rows (revolving cards, or any liability with no term) get
          // no schedule — the BoY fallback carries `liab.balance` forward
          // unchanged instead of letting an empty schedule zero it.
          if (!isHeldFlatLiability(newLiab)) {
            liabilitySchedules.set(newLiab.id, buildLiabilitySchedule(newLiab));
          }
        }
      }
    }

    // Per-account cash deltas plus per-account entry lists for this year. A "credit"
    // with a positive amount is an inflow; negative is an outflow. The entries list
    // gives the ledger modal something to show beyond the summed totals.
    // Hoisted above the equity block so equity net cash routes through the same
    // deferred cashDelta path (flushed once at step 11) as every other flow.
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
        // Cash accounts carry no cost basis distinct from their balance — every
        // dollar in/out moves basis 1:1. Default `basis` to `amount` for cash
        // targets so cash ledgers reconcile by construction (asset-ledger basis
        // column + per-account basis reconciliation). Callers may still pass an
        // explicit basis; non-cash targets are left untouched.
        const basis =
          entry.basis ??
          (accountById.get(acctId)?.category === "cash" ? amount : undefined);
        (pendingEntries[acctId] ??= []).push({ ...entry, amount, basis });
      }
    };

    // ── Equity compensation: vest / exercise / sell events for this year ──────
    // The equity module is authoritative over equity tax + share movement.
    // Acquisitions land in-kind in a destination taxable account (auto-created
    // on first acquisition); sells drain it; the destination's generic growth
    // keeps appreciation unrealized so only the module books the gain. Runs
    // AFTER BoY purchases/sales but BEFORE the growth loop so the destination
    // account participates in this year's growth.
    let equityOrdinaryIncome = 0;
    let equityCapitalGains = 0;
    let equityStCapitalGains = 0;
    let equityIsoSpread = 0;
    // Net equity cash routed to household checking this year (sale proceeds +
    // sell-to-cover proceeds − strike outflow). Surfaced as Other Inflows via
    // income.bySource (drill-down) and folded into totalIncome / netCashFlow
    // below — mirrors householdNoteCashIn. NOT added to income.total/.other.
    let householdEquityCashIn = 0;
    // Per-plan equity result capture (consumed by the reporting surfaces below
    // — bySource breakdowns, equity drill-down). Keyed by base stock_options
    // account id, accumulated across all of this year's events for the plan.
    const equityByPlan = new Map<string, {
      ordinaryIncome: number; capitalGains: number; stCapitalGains: number;
    }>();
    if (equityPlans.length > 0) {
      const checkingId = defaultChecking?.id ?? "";
      for (const plan of equityPlans) {
        const result = computeEquityYear(plan, equityState, year);
        const hasActivity =
          result.acquisitions.length > 0 ||
          result.sellProceeds > 0 ||
          result.ordinaryIncome !== 0 ||
          result.isoSpread !== 0 ||
          result.strikeCashOutflow !== 0;
        if (!hasActivity) continue;

        // Resolve / lazily create the destination taxable account.
        let destId =
          plan.destinationAccountId ?? equityDestByPlan.get(plan.accountId) ?? null;
        if (!destId && plan.autoCreateDestination) {
          destId = `equity-dest-${plan.accountId}`;
          equityDestByPlan.set(plan.accountId, destId);
          // Mirror applyAssetPurchases' synthetic-account creation. The
          // realization mix is pure LTCG with no turnover so the generic
          // growth loop keeps appreciation unrealized — the equity module is
          // the sole gain-booker, avoiding double tax.
          const destAccount: Account = {
            id: destId,
            name: `${plan.ticker ?? "Equity"} shares`,
            category: "taxable",
            subType: "brokerage",
            value: 0,
            basis: 0,
            growthRate: plan.growthRate,
            rmdEnabled: false,
            titlingType: "jtwros",
            realization: {
              pctOrdinaryIncome: 0,
              pctLtCapitalGains: 1,
              pctQualifiedDividends: 0,
              pctTaxExempt: 0,
              turnoverPct: 0,
            },
            // Household-owned (single client), mirroring applyAssetPurchases.
            owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
          };
          workingAccounts.push(destAccount);
          accountBalances[destId] = 0;
          basisMap[destId] = 0;
          accountLedgers[destId] = {
            beginningValue: 0,
            growth: 0,
            contributions: 0,
            distributions: 0,
            internalContributions: 0,
            internalDistributions: 0,
            rmdAmount: 0,
            fees: 0,
            endingValue: 0,
            entries: [],
            basisBoY: 0,
          };
        }
        if (!destId) destId = checkingId; // fallback: no destination → land value in checking

        const applied = applyEquityYear(result, destId, accountBalances, basisMap);
        const planAcqValue = result.acquisitions.reduce((s, a) => s + a.value, 0);
        const prev = equityByPlan.get(plan.accountId) ?? {
          ordinaryIncome: 0, capitalGains: 0, stCapitalGains: 0,
        };
        equityByPlan.set(plan.accountId, {
          ordinaryIncome: prev.ordinaryIncome + applied.taxDeltas.ordinaryIncome,
          capitalGains:   prev.capitalGains   + applied.taxDeltas.capitalGains,
          stCapitalGains: prev.stCapitalGains + applied.taxDeltas.stCapitalGains,
        });
        equityOrdinaryIncome += applied.taxDeltas.ordinaryIncome;
        equityCapitalGains += applied.taxDeltas.capitalGains;
        equityStCapitalGains += applied.taxDeltas.stCapitalGains;
        equityIsoSpread += applied.taxDeltas.isoSpread;

        // Portfolio Activity: write the dest-account ledger directly (NOT via
        // creditCash — only the checking cash is deferred). Acquisitions are
        // in-kind contributions when shares vest; sells are distributions that
        // offset the checking inflow so net worth isn't double-counted. The
        // value movements already landed on accountBalances/basisMap inside
        // applyEquityYear; here we keep the ledger's running endingValue and
        // contributions/distributions in step with them.
        // destId can fall back to checkingId when autoCreateDestination is false;
        // don't post share-movement entries onto the household checking ledger
        // (its flows net via checkingExternalDelta, and the cash still lands via
        // the creditCash call below).
        if (destId && destId !== checkingId && accountLedgers[destId]) {
          if (planAcqValue > 0) {
            accountLedgers[destId].contributions += planAcqValue;
            accountLedgers[destId].endingValue += planAcqValue;
            accountLedgers[destId].entries.push({
              category: "income",
              label: `${plan.ticker ?? "Equity"} shares vest`,
              amount: planAcqValue,
              sourceId: plan.accountId,
            });
          }
          if (result.sellProceeds > 0) {
            accountLedgers[destId].distributions += result.sellProceeds;
            accountLedgers[destId].endingValue -= result.sellProceeds;
            accountLedgers[destId].entries.push({
              category: "withdrawal",
              label: `${plan.ticker ?? "Equity"} shares sold`,
              amount: -result.sellProceeds,
              sourceId: plan.accountId,
            });
          }
        }

        // Route the net equity cash through the deferred cashDelta path so the
        // household-checking Portfolio Activity column and net-cash-flow see it
        // exactly once (flushed at step 11). applyEquityYear no longer credits
        // checking directly — this is the sole crediting point.
        creditCash(checkingId, applied.netCashToChecking, {
          category: "income",
          label: `${plan.ticker ?? "Equity"} equity proceeds`,
          sourceId: plan.accountId,
        });

        // Surface the proceeds as Other Inflows: income.bySource (a scalar map)
        // gets a per-plan key for the drill-down, and householdEquityCashIn is
        // folded into totalIncome below. Deliberately NOT added to
        // income.total / income.other — those stay as computeIncome reported
        // them, so the cash is counted exactly once (creditCash + the
        // totalIncome fold). Mirrors the notes-receivable pattern.
        if (applied.netCashToChecking > 0) {
          householdEquityCashIn += applied.netCashToChecking;
          const key = `equity-proceeds:${plan.accountId}`;
          income.bySource[key] = (income.bySource[key] ?? 0) + applied.netCashToChecking;
        }
      }
    }
    // ISO bargain element is an AMT-preference item, not regular-taxable.
    // Threaded into computeTaxForYear below as the AMTI add-back; accumulated
    // here so the wiring lands in one place.

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

    // ── Apply Reinvestments ─────────────────────────────────────────────────
    // Retarget account growth profiles before this year's growth pass. The
    // mutation persists for later years until another reinvestment overrides it.
    let reinvestmentResult = {
      capitalGains: 0,
      byReinvestment: {} as Record<string, { capitalGains: number; label: string }>,
    };
    if (activeReinvestments.length > 0) {
      reinvestmentResult = applyReinvestments({
        reinvestments: activeReinvestments,
        accounts: workingAccounts,
        accountBalances,
        basisMap,
        accountLedgers,
        year,
      });
    }

    // Start-of-year balances for education dedicated accounts (before growth /
    // savings), so the report's "Dedicated Assets (BOY)" is a true
    // beginning-of-year figure. The funding pass itself runs after savings.
    // The proration gate is carried alongside each goal so the funding pass
    // below reuses it instead of recomputing per year × trial.
    const allEducationGoals = data.expenses.flatMap((e) => {
      if (e.type !== "education") return [];
      return [{ goal: e, gate: itemProrationGate(e, year, data.client) }];
    });
    const educationGoalsThisYear = allEducationGoals.filter(({ gate }) => gate.include);
    // BOY captured across ALL education goals (not just active ones) so the
    // pre-expense accumulation pass below can report a true beginning-of-year
    // balance for the funding-runway years too.
    const eduDedicatedIds = new Set<string>(
      allEducationGoals.flatMap(({ goal }) => goal.dedicatedAccountIds ?? []),
    );
    const eduBoyBalances: Record<string, number> = {};
    for (const id of eduDedicatedIds) eduBoyBalances[id] = accountBalances[id] ?? 0;

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
      // Cost-basis delta this growth entry adds to basisMap — equals the
      // recognized in-year basisIncrease, but ONLY where the gate below
      // actually applies it (taxable/cash). Stays 0 on retirement accounts.
      let growthBasisDelta = 0;

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
          freshBasisMap[acct.id] = (freshBasisMap[acct.id] ?? 0) + basisIncrease;
          growthBasisDelta = basisIncrease;
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
            // §664(c): CRT shares are exempt — excluded from householdLikeShare. (F1)
            if (isTaxExemptTrust(owner.entityId)) continue;
            if (effectiveIsGrantor(owner.entityId, year)) grantorShare += owner.percent;
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
            if (isTaxExemptTrust(owner.entityId)) continue; // §664(c) (F1)
            if (!effectiveIsGrantor(owner.entityId, year)) continue;
            const bucket = grantorTrustIncomeByEntity.get(owner.entityId);
            if (bucket) {
              bucket.ordinary += oi * owner.percent;
              bucket.dividends += qdiv * owner.percent;
              bucket.taxExempt += taxExempt * owner.percent;
            }
          }

          // Per non-grantor-entity owner: split routing by entityType.
          //   trust         → emit to yearRealizations[] for the trust-tax pass (unchanged).
          //   non-trust biz → roll the entity's pro-rata share into household
          //                   tax detail with character preserved (LLC, S-corp,
          //                   partnership, c_corp, foundation, other are all
          //                   treated as pass-through under the current spec).
          //                   See spec 2026-05-11-business-distribution-passthrough-design.
          for (const owner of yearOwners) {
            if (owner.kind !== "entity") continue;
            // §664(c): CRT shares never reach the 1041 pass. Without this the
            // exemption above would push them down the non-grantor branch. (F1)
            if (isTaxExemptTrust(owner.entityId)) continue;
            if (effectiveIsGrantor(owner.entityId, year)) continue;
            const ownerEntity = entityMap[owner.entityId];
            const isTrust = ownerEntity?.entityType === "trust";
            if (isTrust) {
              yearRealizations.push({
                accountId: acct.id,
                ownerEntityId: owner.entityId,
                ordinary: oi * owner.percent,
                dividends: qdiv * owner.percent,
                taxExempt: taxExempt * owner.percent,
                capGains: stcg * owner.percent, // ambient — collect-trust-income ignores this per convention
              });
            } else {
              const oiE = oi * owner.percent;
              const qdivE = qdiv * owner.percent;
              const stcgE = stcg * owner.percent;
              realizationOI += oiE;
              realizationQDiv += qdivE;
              realizationSTCG += stcgE;
              if (oiE > 0) realizationBySource[`${acct.id}:oi:${owner.entityId}`] = { type: "ordinary_income", amount: oiE };
              if (qdivE > 0) realizationBySource[`${acct.id}:qdiv:${owner.entityId}`] = { type: "dividends", amount: qdivE };
              if (stcgE > 0) realizationBySource[`${acct.id}:stcg:${owner.entityId}`] = { type: "stcg", amount: stcgE };
            }
          }
        }
      }

      accountLedgers[acct.id].growth += growth;
      accountLedgers[acct.id].endingValue += growth;
      accountLedgers[acct.id].entries.push({
        category: "growth",
        label: `Growth (${(effectiveGrowthRate * 100).toFixed(2)}%)`,
        amount: growth,
        basis: growthBasisDelta,
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

    // stock_options base accounts hold only not-yet-acquired value (the equity
    // module already moved acquired shares into the destination taxable account).
    // Overwrite AFTER the growth loop so the value isn't double-grown — the
    // valuation projects FMV/intrinsic from the start-year price itself.
    for (const plan of equityPlans) {
      accountBalances[plan.accountId] = remainingGrantValue(plan, year, planSettings.planStartYear);
    }

    // ── Stress test — one-time market crash ─────────────────────────────────
    // Write down market-exposed balances AFTER growth so the reduced balance
    // feeds RMDs/withdrawals/taxes this year and compounds forward off the
    // lower base (in deterministic and every MC trial alike).
    applyMarketShock(accountBalances, workingAccounts, year, planSettings.marketShock, accountLedgers);

    // ── Apply Transfers ─────────────────────────────────────────────────────
    let transferResult: TransfersResult = {
      taxableOrdinaryIncome: 0,
      capitalGains: 0,
      earlyWithdrawalPenalty: 0,
      byTransfer: {},
    };
    if (data.transfers && data.transfers.length > 0) {
      transferResult = applyTransfers({
        transfers: data.transfers,
        accounts: workingAccounts,
        accountBalances,
        basisMap,
        freshBasisMap,
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
      const grossBasis =
        isFirstProjectionYear && acct.priorYearEndValue != null
          ? acct.priorYearEndValue
          : accountLedgers[acct.id]?.beginningValue ?? accountBalances[acct.id] ?? 0;
      // SECURE 2.0 §325 (2024+): designated Roth 401(k)/403(b) balances are
      // exempt from lifetime RMDs, so the basis is the pre-tax slice only.
      // rothValueBoY is stamped alongside beginningValue (before growth) —
      // the live rothValueMap has already grown and would over-subtract.
      const rothValueBoY = accountLedgers[acct.id]?.rothValueBoY ?? 0;
      let rmdBasis: number;
      if (isFirstProjectionYear && acct.priorYearEndValue != null) {
        // `grossBasis` here is `priorYearEndValue` — a prior-Dec-31 custodian
        // snapshot on a different scale than the current-snapshot rothValueBoY.
        // Subtracting raw Roth dollars mixes scales (and can zero a real RMD),
        // so apply the current Roth *fraction* to the prior-year gross instead.
        const beginningGross = accountLedgers[acct.id]?.beginningValue ?? accountBalances[acct.id] ?? 0;
        const rothFraction = beginningGross > 0 ? Math.min(1, rothValueBoY / beginningGross) : 0;
        rmdBasis = grossBasis * (1 - rothFraction);
      } else {
        rmdBasis = Math.max(0, grossBasis - rothValueBoY);
      }
      const currentBalance = accountBalances[acct.id] ?? 0;
      // Cap at the current pre-tax balance so an RMD never forces out Roth
      // dollars (the distribution is booked 100% pre-tax below).
      const preTaxBalance = Math.max(0, currentBalance - (rothValueMap[acct.id] ?? 0));
      const rmd = Math.min(preTaxBalance, calculateRMD(rmdBasis, ownerAge, ownerBirthYear));
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
          basis: 0, // pre-tax retirement distribution: no cost basis moves
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
        creditCash(defaultChecking?.id, rmd, { category: "rmd", label: rmdLabel, sourceId: acct.id, basis: rmd });
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
          basis: rmd, // cash inflow into entity checking: basis == amount (1:1)
        });
        if (
          // §664(c): CRT-owned RMDs are exempt. (F1)
          !isTaxExemptTrust(entityOwner.entityId) &&
          effectiveIsGrantor(entityOwner.entityId, year)
        ) {
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

    // ── Roth Conversions (technique) — deferred application ────────────────
    // We initialize an empty result here so downstream taxableIncome / taxDetail
    // construction can reference it as a placeholder. The actual conversion
    // runs later in the year, AFTER aboveLine + itemized deductions are known,
    // so the `fill_up_bracket` strategy can use a real `incomeTaxBase`-aware
    // closure (accurate against taxable SS, QBI, above-line, itemized > std).
    let rothConversionResult = {
      taxableOrdinaryIncome: 0,
      earlyWithdrawalPenalty: 0,
      byConversion: {} as Record<string, { gross: number; taxable: number; bySource: Record<string, number> }>,
    };

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
      reinvestmentResult.capitalGains +
      rothConversionResult.taxableOrdinaryIncome +
      saleResult.capitalGains +
      businessSaleResult.capitalGains +
      equityOrdinaryIncome +
      equityCapitalGains +
      equityStCapitalGains;
    // Build per-year tax detail breakdown. Income items use their taxType when
    // set, otherwise fall back to the legacy type-based mapping.
    const taxDetail: ProjectionYear["taxDetail"] = {
      // Equity W-2 ordinary income (RSU vest FMV, NQSO/disqualifying-ISO
      // bargain element) is FICA-bearing earned income.
      earnedIncome: equityOrdinaryIncome,
      ordinaryIncome: realizationOI,
      dividends: realizationQDiv,
      // Equity capital gains booked on sale by the equity module. Asset-sale
      // and entity gains still add via taxDetail.capitalGains += ... later.
      capitalGains: equityCapitalGains,
      stCapitalGains: realizationSTCG + equityStCapitalGains,
      qbi: 0,
      taxExempt: 0,
      // Subset of taxExempt — muni-bond interest only (needed for IRMAA MAGI).
      // Excludes business non_taxable pass-through (Roth-equivalent / RoC).
      taxExemptInterest: 0,
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
      // Business-account income is taxed in the Phase 3 K-1 incidence block
      // below — skipping here prevents a double-count (legacyTaxType would
      // land it in ordinaryIncome AND Phase 3 would re-add it as qbi).
      if (inc.ownerAccountId != null) continue;
      if (inc.ownerEntityId != null) {
        // Non-grantor entity rows → handled below (Phase 3 K-1 incidence for
        // non-trust; trust-tax pass for trust). Grantor BUSINESS entity rows
        // also flow through Phase 3 K-1 below — only grantor trust rows fall
        // through to the household 1040 here.
        // §664(c): CRT-owned rows are exempt. (F1)
        if (isTaxExemptTrust(inc.ownerEntityId)) continue;
        if (!effectiveIsGrantor(inc.ownerEntityId, year)) continue;
        if (entityMap[inc.ownerEntityId]?.entityType !== "trust") continue;
      }
      if (inc.type === "social_security") continue;
      // H2: honor scheduleOverrides so the taxed amount matches the cash
      // deposited by computeIncome (income.ts:133-142) and the cash-routing
      // loop (which read income.bySource). Re-deriving from annualAmount×growth
      // here taxed a different number than was received whenever an override
      // cell diverged from the growth curve.
      let amount: number;
      if (inc.scheduleOverrides) {
        amount = inc.scheduleOverrides[year] ?? 0;
      } else {
        const inflateFrom = inc.inflationStartYear ?? inc.startYear;
        amount = inc.annualAmount * Math.pow(1 + inc.growthRate, year - inflateFrom);
      }
      amount *= incGate.factor;
      const tt = inc.taxType ?? legacyTaxType(inc.type);
      switch (tt) {
        case "earned_income": taxDetail.earnedIncome += amount; break;
        case "ordinary_income": taxDetail.ordinaryIncome += amount; break;
        case "dividends": taxDetail.dividends += amount; break;
        case "capital_gains": taxDetail.capitalGains += amount; break;
        case "stcg": taxDetail.stCapitalGains += amount; break;
        case "qbi": taxDetail.qbi += amount; break;
        case "tax_exempt":
          taxDetail.taxExempt += amount;
          taxDetail.taxExemptInterest += amount;
          break;
      }
      taxDetail.bySource[inc.id] = { type: tt, amount };
    }

    // ── Notes-receivable per-year emission ─────────────────────────────────
    // For each note receivable, run the installment-sale split (IRC §453):
    //   - interest portion → ordinary income (per owner share)
    //   - principal portion → LTCG share + basis-recovery share (per owner share)
    //   - total cash → credit owner's checking (household for family_member
    //     owners; entity checking for entity owners)
    //
    // Trust-side outflow: when `linkedTrustEntityId` is set on the note, the
    // trust is the debtor — drain its cash accounts pro-rata by current
    // balance (effective: accountBalances + pending cashDelta since this
    // block runs before the step-11 flush). If the trust's cash can't cover
    // the payment, emit a `trust_note_cash_shortfall` warning. The negative
    // checking that may result will be picked up by the entity-overdraft
    // gap-fill in step 12c.
    const notesYearResult = computeNotesReceivable(notesReceivable, noteSchedules, year);
    const noteShortfallWarnings: TrustWarning[] = [];
    const notesReceivableByNote: Record<string, {
      interest: number;
      principalLTCG: number;
      principalBasis: number;
      totalCashIn: number;
      endingBalance: number;
    }> = {};
    // Household-side note cash for the year (family-member owner shares only —
    // entity-owner shares route to entity checking and don't belong in the
    // household netCashFlow). Folded into totalIncome / netCashFlow below so
    // the cashflow report's Net Cash Flow row reconciles with Total Income.
    let householdNoteCashIn = 0;

    for (const note of notesReceivable) {
      const yr = notesYearResult.byNote.get(note.id);
      // Always record an ending-balance row so the balance-sheet UI can show
      // pre-start and post-payoff years (both resolve to schedule boundary
      // values inside computeNotesReceivable via the underlying schedule).
      const schedule = noteSchedules.get(note.id) ?? [];
      const lastRow = schedule[schedule.length - 1];
      let endingBalance = 0;
      if (schedule.length > 0) {
        if (year < schedule[0].year) endingBalance = schedule[0].beginningBalance;
        else if (year >= lastRow.year) endingBalance = lastRow.endingBalance;
        else endingBalance = noteScheduleByYear.get(note.id)?.get(year)?.endingBalance ?? 0;
      }
      notesReceivableByNote[note.id] = {
        interest: yr?.interest ?? 0,
        principalLTCG: yr?.principalLTCG ?? 0,
        principalBasis: yr?.principalBasis ?? 0,
        totalCashIn: yr?.totalCashIn ?? 0,
        endingBalance: yr?.endingBalance ?? endingBalance,
      };

      if (yr == null || yr.totalCashIn === 0) continue;

      // 1. Per-owner split: family_member owners route to household checking +
      //    household 1040 tax detail; entity owners route to the entity's
      //    checking (entity-side tax treatment is the owning entity's
      //    responsibility — out of scope here).
      for (const owner of note.owners) {
        if (owner.percent <= 0) continue;
        const cashShare = yr.totalCashIn * owner.percent;
        const interestShare = yr.interest * owner.percent;
        const ltcgShare = yr.principalLTCG * owner.percent;

        if (owner.kind === "family_member") {
          if (interestShare > 0) {
            taxDetail.ordinaryIncome += interestShare;
            const key = `note:${note.id}:interest`;
            taxDetail.bySource[key] = {
              type: "ordinary_income",
              amount: (taxDetail.bySource[key]?.amount ?? 0) + interestShare,
            };
          }
          if (ltcgShare > 0) {
            taxDetail.capitalGains += ltcgShare;
            const key = `note:${note.id}:ltcg`;
            taxDetail.bySource[key] = {
              type: "capital_gains",
              amount: (taxDetail.bySource[key]?.amount ?? 0) + ltcgShare,
            };
          }
          if (cashShare > 0) {
            creditCash(defaultChecking?.id, cashShare, {
              category: "income",
              label: `Note payment from ${note.name}`,
              sourceId: note.id,
            });
            householdNoteCashIn += cashShare;
          }
        } else if (owner.kind === "entity") {
          // Route to entity checking. Entity-level tax is not modeled here
          // (entity-side tax treatment is the owning entity's responsibility).
          const entityCheckingId = entityCheckingByEntityId[owner.entityId];
          if (cashShare > 0 && entityCheckingId) {
            creditCash(entityCheckingId, cashShare, {
              category: "income",
              label: `Note payment from ${note.name}`,
              sourceId: note.id,
            });
          }
        }
      }

      // 2. Trust-side outflow when the note is linked to a trust entity.
      //    The trust is the debtor — drain its cash accounts pro-rata by
      //    current balance. If the trust's cash can't cover the payment,
      //    emit a `trust_note_cash_shortfall` warning. The negative checking
      //    that may result will be picked up by the entity-overdraft gap-fill
      //    in step 12c.
      if (note.linkedTrustEntityId != null) {
        const trustId = note.linkedTrustEntityId;
        const trust = entityMap[trustId];
        const payment = yr.totalCashIn;
        if (trust && payment > 0) {
          const trustCashAccounts = workingAccounts.filter(
            (acc) =>
              acc.category === "cash" &&
              controllingEntity(acc) === trustId,
          );
          const effectiveBalanceOf = (id: string) =>
            (accountBalances[id] ?? 0) + (cashDelta[id] ?? 0);
          const cashAvailable = trustCashAccounts.reduce(
            (s, c) => s + Math.max(0, effectiveBalanceOf(c.id)),
            0,
          );
          const paid = Math.min(cashAvailable, payment);
          if (paid > 0 && cashAvailable > 0) {
            const ratio = paid / cashAvailable;
            for (const c of trustCashAccounts) {
              const bal = Math.max(0, effectiveBalanceOf(c.id));
              if (bal <= 0) continue;
              creditCash(c.id, -bal * ratio, {
                category: "expense",
                label: `Note payment to ${note.name}`,
                sourceId: note.id,
              });
            }
          }
          if (paid < payment) {
            noteShortfallWarnings.push({
              code: "trust_note_cash_shortfall",
              entityId: trustId,
              year,
              shortfall: payment - paid,
            });
          }
        }
      }
    }

    // ── Phase 3: business-account tax incidence (passthrough K-1) ─────────
    // For each top-level business account, compute net income (income rows
    // tagged with ownerAccountId minus expense rows tagged with
    // ownerAccountId) and flow it to family-member owners' 1040 buckets per
    // the business' taxTreatment, scaled by each owner's percent.
    // Per spec § Phase 3 decisions:
    //   P3-2: qbi → qbi; ordinary → ordinaryIncome; non_taxable → taxExempt
    //   P3-6: ownership gap (sum < 1) → only known shares are taxed
    //   P3-8: losses (net ≤ 0) → no tax incidence
    //
    // Also adds family-owned taxable share to `taxableIncome` so flat-rate mode
    // (which reads taxableIncome, not taxDetail buckets) picks it up correctly.
    // Bracket mode reads taxDetail directly, so both modes are covered.
    const businessAccountsThisYear = data.accounts.filter(
      (a) =>
        a.category === "business" &&
        a.parentAccountId == null &&
        !isPreActivation(a, year),
    );
    for (const business of businessAccountsThisYear) {
      const flow = computeBusinessYearFlow(
        business,
        year,
        currentIncomes,
        allExpenses,
        data.accountFlowOverrides,
      );
      const netIncome = flow.gross - flow.exp;
      if (netIncome <= 0) continue;
      const treatment = business.businessTaxTreatment ?? "ordinary";
      // Pass-through taxation attributes to household owners only. Entity-kind
      // owners (e.g. a trust holding the business) don't pass income through
      // to the household 1040; they retain it at the holder level.
      const familyOwners = business.owners.filter(
        (o) => o.kind === "family_member",
      );
      let businessFamilyTaxable = 0;
      for (const owner of familyOwners) {
        const taxableShare = netIncome * owner.percent;
        if (taxableShare === 0) continue;
        businessFamilyTaxable += taxableShare;
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
        taxableIncome += businessFamilyTaxable;
      }
      // Drilldown: attribute the business's total taxable amount under one bySource
      // key so reports can identify the source. Owner % split is a 1040 detail
      // not surfaced in bySource.
      const totalTaxable = netIncome * familyOwners.reduce((s, o) => s + o.percent, 0);
      if (totalTaxable !== 0) {
        const bySourceType =
          treatment === "qbi" ? "qbi"
          : treatment === "non_taxable" ? "tax_exempt"
          : "ordinary_income";
        taxDetail.bySource[`business_passthrough:${business.id}`] = {
          type: bySourceType,
          amount: totalTaxable,
        };
      }
    }

    // ── Phase 3 (entity model): EntitySummary business K-1 tax incidence ─────
    // H1: account-model counterpart of the loop above, for businesses modeled
    // as EntitySummary rows (entityType llc|s_corp|c_corp|partnership|
    // foundation|other). Their income is skipped by the household-1040 loop
    // (ownerEntityId rows, lines 1834-1840) on the promise it's taxed here —
    // but that block only ever iterated account-model businesses, so entity
    // pass-through income was distributed as cash (the sweep further below) yet
    // taxed $0. Tax exactly the set that sweep distributes: all non-trust
    // currentEntities with family owners and positive net income (the sweep
    // ignores grantor status, so we do too). Trusts keep the 1041/grantor
    // passes and are excluded. Keyed off ownerEntityId (via
    // computeBusinessEntityNetIncome) vs the account-model block's ownerAccountId
    // (via computeBusinessYearFlow), so the two never double-tax the same row.
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
      const treatment = entity.taxTreatment ?? "ordinary";
      const familyOwners = (entity.owners ?? []).filter(
        (o) => o.kind === "family_member",
      );
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
      // Flat-rate mode reads taxableIncome, not taxDetail buckets — mirror the
      // account-model block (non_taxable stays out of taxableIncome).
      if (treatment !== "non_taxable") {
        taxableIncome += entityFamilyTaxable;
      }
      const totalTaxable =
        netIncome * familyOwners.reduce((s, o) => s + o.percent, 0);
      if (totalTaxable !== 0) {
        const bySourceType =
          treatment === "qbi" ? "qbi"
          : treatment === "non_taxable" ? "tax_exempt"
          : "ordinary_income";
        taxDetail.bySource[`business_passthrough:${entity.id}`] = {
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

    // §664(c): net each CRT's share of this year's sale gains OUT of the
    // household 1040. (F1)
    //
    // This has to happen at the ADD, not via the trust-owned subtraction in the
    // non-grantor pass below: that subtraction lives inside
    // `if (nonGrantorTrusts.length > 0)`, and a CRT is never in that list, so a
    // CRT-only plan skips the block entirely and the gain would stay on the
    // 1040. Netting here is also independent of the grantor fork, which is what
    // §664(c) requires — the trust is exempt in EITHER isGrantor config.
    const crtSaleGainByTxn = new Map<string, number>();
    for (const item of saleResult.breakdown) {
      const sold = accountById.get(item.accountId);
      if (!sold) continue;
      const saleYearOwners = ownersForYear(sold, data.giftEvents, year, planSettings.planStartYear);
      let crtShare = 0;
      for (const owner of saleYearOwners) {
        if (owner.kind !== "entity") continue;
        if (!isTaxExemptTrust(owner.entityId)) continue;
        crtShare += owner.percent;
      }
      if (crtShare > 0) {
        crtSaleGainByTxn.set(
          item.transactionId,
          (crtSaleGainByTxn.get(item.transactionId) ?? 0) + item.capitalGain * crtShare,
        );
      }
    }
    const crtSaleGainTotal = [...crtSaleGainByTxn.values()].reduce((s, g) => s + g, 0);

    // Add transfer and sale income to tax detail
    taxDetail.ordinaryIncome += transferResult.taxableOrdinaryIncome;
    taxDetail.ordinaryIncome += rothConversionResult.taxableOrdinaryIncome;
    taxDetail.capitalGains +=
      transferResult.capitalGains +
      reinvestmentResult.capitalGains +
      saleResult.capitalGains +
      businessSaleResult.capitalGains +
      grantorCarryInCapGains;
    if (crtSaleGainTotal > 0) {
      taxDetail.capitalGains = Math.max(0, taxDetail.capitalGains - crtSaleGainTotal);
    }
    if (grantorCarryInCapGains > 0) {
      taxDetail.bySource["entity_gap_fill_prior_year:capital_gains"] = {
        type: "capital_gains",
        amount: grantorCarryInCapGains,
      };
    }

    // Track sources for drill-down. R3: key off the recognized ORDINARY slice,
    // not the gross transfer — a qualified Roth/HSA move (or a taxable-source
    // liquidation) has $0 ordinary income, so it must not book a phantom taxable
    // Transfer row. A transfer is an internal asset move, not a cash-flow income
    // event, and never feeds taxFreeRetirementIncome, so there is no tax-free row.
    for (const [tid, info] of Object.entries(transferResult.byTransfer)) {
      if (info.taxableOrdinaryIncome > 0) {
        taxDetail.bySource[`transfer:${tid}`] = { type: "ordinary_income", amount: info.taxableOrdinaryIncome };
      }
    }
    for (const [cid, info] of Object.entries(rothConversionResult.byConversion)) {
      if (info.taxable > 0) {
        taxDetail.bySource[`roth_conversion:${cid}`] = { type: "ordinary_income", amount: info.taxable };
      }
    }
    for (const item of saleResult.breakdown) {
      // §664(c): itemize only the non-CRT share — the drill-down must reconcile
      // to the capitalGains total netted above, not re-assert the exempt slice. (F1)
      const householdGain = item.capitalGain - (crtSaleGainByTxn.get(item.transactionId) ?? 0);
      if (householdGain > 0) {
        taxDetail.bySource[`sale:${item.transactionId}`] = { type: "capital_gains", amount: householdGain };
      }
    }
    for (const item of businessSaleResult.breakdown) {
      if (item.totalCapitalGain > 0) {
        taxDetail.bySource[`business_sale:${item.transactionId}`] = {
          type: "capital_gains",
          amount: item.totalCapitalGain,
        };
      }
    }
    for (const [rid, info] of Object.entries(reinvestmentResult.byReinvestment)) {
      if (info.capitalGains > 0) {
        taxDetail.bySource[`reinvestment:${rid}`] = { type: "capital_gains", amount: info.capitalGains };
      }
    }
    // Per-plan equity bySource (tax-drill itemization — spec §B).
    for (const [planId, eq] of equityByPlan) {
      if (eq.ordinaryIncome > 0) {
        taxDetail.bySource[`equity-vest:${planId}`] = { type: "earned_income", amount: eq.ordinaryIncome };
      }
      if (eq.capitalGains > 0) {
        taxDetail.bySource[`equity-ltcg:${planId}`] = { type: "capital_gains", amount: eq.capitalGains };
      }
      if (eq.stCapitalGains > 0) {
        taxDetail.bySource[`equity-stcg:${planId}`] = { type: "stcg", amount: eq.stCapitalGains };
      }
    }

    // F8: received trust cash fold. Accumulate the trust cash that physically
    // reaches the household default checking across the passes below (CRT
    // payments + non-grantor DNI distributions), so `totalIncome` — and thus
    // Net Cash Flow and the surplus base — reflect cash received. The tax side
    // already exists (CRT ordinaryIncome, DNI householdIncomeDelta); this is the
    // missing income/cash-flow line. Mirrors householdNoteCashIn (audit F8).
    let householdTrustCashIn = 0;

    // F2: grantor-trust cash actually distributed to the household. The surplus
    // base counts grantor gross via grantorIncome (cash routes to TRUST checking),
    // so replace gross with cash-received below by subtracting
    // (grantorGrossFolded − grantorTrustDistToHousehold). A retained trust then
    // contributes 0 to discretionary surplus (audit F2).
    let grantorTrustDistToHousehold = 0;

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
          // §664(c): CRT gains are exempt — they were already netted out of the
          // household ADD above and must not reach the 1041 pass either. This
          // also keeps them out of `sameYearTrustGains`, which would otherwise
          // subtract a gain the household was never charged for and under-tax
          // the household's OWN gains in a plan that mixes a CRT with an
          // ordinary non-grantor trust. (F1)
          if (isTaxExemptTrust(owner.entityId)) continue;
          if (effectiveIsGrantor(owner.entityId, year)) continue;
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
      // CLTs) we need to feed this year's lead payment into the trust-tax
      // pass as a charitable deduction. The payment amount is a function of
      // BoY FMV (CLUT) or fixed (CLAT) so we can pre-compute it here before
      // the actual emission happens later in the year loop's CLT annual
      // payment block.
      const nonGrantorTrustsWithDeductions = nonGrantorTrusts.map((t) => {
        const ent = entityMap[t.entityId];
        if (!ent || ent.trustSubType !== "clt" || !ent.splitInterest) return t;
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
        if (startOfYearFmv <= 0 && si.payoutType !== "annuity") return t;
        let annualPayment: number;
        if (si.payoutType === "annuity") {
          const { annuityAmount } = computeAnnualAnnuityPayment({
            payoutAmount: Number(si.payoutAmount ?? 0),
          });
          annualPayment = annuityAmount;
        } else {
          const { unitrustAmount } = computeAnnualUnitrustPayment({
            payoutPercent: Number(si.payoutPercent ?? 0),
            startOfYearFmv,
          });
          annualPayment = unitrustAmount;
        }
        return annualPayment > 0
          ? { ...t, charitableDeduction: annualPayment }
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
      // Trust-side tax-exempt is muni interest (originates from
      // realization.pctTaxExempt on trust-held bond accounts), so it also
      // counts toward IRMAA MAGI.
      taxDetail.taxExemptInterest += trustPassResult.householdIncomeDelta.taxExempt;

      // Apply trust cash debits (full distribution + trust tax paid) and credit
      // the household beneficiary's share. Mirrors the grantor pass below.
      //
      // We deliberately allow checking to go negative here — step 12c (entity
      // gap-fill) runs later in the year and will liquidate the trust's other
      // liquid assets to cover the deficit, emitting `entity_overdraft` if the
      // remaining liquid pool is insufficient.
      //
      // H8/H9/M10: debit the FULL `actualAmount` (not just `drawFromCash`) via
      // creditCash — so (a) the `drawFromTaxable` slice actually drives checking
      // negative and gap-fill drains the trust's own brokerage to fund it
      // (realizing the gain), rather than the distribution being recognized-but-
      // never-drained (H9 value creation); and (b) the trust-checking ledger
      // records the outflow so I1 holds (M10). Then credit the household its
      // share of the distributed cash (H8): previously the DNI was taxed to the
      // household via householdIncomeDelta above but the cash never arrived.
      // Non-household beneficiary shares (family members / external) exit the
      // projection scope, same as the grantor pass's non-household case.
      for (const trust of nonGrantorTrusts) {
        const checkingId = entityCheckingByEntityId[trust.entityId];
        if (!checkingId) continue;
        const dist = trustPassResult.distributionsByEntity.get(trust.entityId);
        const tax = trustPassResult.taxByEntity.get(trust.entityId);
        const distAmount = dist?.actualAmount ?? 0;
        const taxAmount = tax?.total ?? 0;
        if (distAmount > 0) {
          creditCash(checkingId, -distAmount, {
            category: "expense",
            label: `Non-grantor trust distribution out`,
            sourceId: trust.entityId,
          });
        }
        if (taxAmount > 0) {
          creditCash(checkingId, -taxAmount, {
            category: "tax",
            label: `Trust income tax`,
            sourceId: trust.entityId,
          });
        }
        // Household beneficiary share of the distributed cash (client/spouse
        // income beneficiaries). Matches the householdIncomeDelta share taxed
        // above, so the household is taxed on and receives the same proportion.
        const householdSharePct = (trust.incomeBeneficiaries ?? [])
          .filter((b) => b.householdRole === "client" || b.householdRole === "spouse")
          .reduce((sum, b) => sum + b.percentage, 0);
        if (distAmount > 0 && householdSharePct > 0) {
          const householdDistCash = (distAmount * householdSharePct) / 100;
          creditCash(defaultChecking?.id, householdDistCash, {
            category: "income",
            label: `Non-grantor trust distribution`,
            sourceId: trust.entityId,
          });
          householdTrustCashIn += householdDistCash; // F8
        }
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
          if (!effectiveIsGrantor(owner.entityId, year)) continue;
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
          grantorTrustDistToHousehold += dist.actualAmount; // F2
        }
      }
    }

    // ── CLT annual payment pass ───────────────────────────────────────────
    // Each year of a CLT's term, the trust pays either a fixed % of its BoY
    // FMV (CLUT) or a fixed annuity amount (CLAT) to the designated charity.
    // Cash-first via creditCash; if trust checking goes negative, step 12c
    // gap-fill liquidates trust assets and attributes any realized gains to
    // the grantor via the deferred-gain mechanism. Tasks 11-12 add
    // post-grantor-death tax routing (§170(f)(2)(B) recapture and §642(c)
    // deduction); this block handles only the cash-flow.
    let cltCharitableOutflowsTotal = 0;
    const cltCharitableOutflowDetail: Array<{
      kind: "clt_payment";
      trustId: string;
      trustName: string;
      charityId: string;
      amount: number;
      payoutType: "unitrust" | "annuity";
    }> = [];
    for (const trust of currentEntities) {
      if (trust.trustSubType !== "clt" || !trust.splitInterest) continue;
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
      if (startOfYearFmv <= 0 && si.payoutType !== "annuity") continue;

      let annualPayment: number;
      let paymentLabel: string;
      if (si.payoutType === "annuity") {
        const { annuityAmount } = computeAnnualAnnuityPayment({
          payoutAmount: Number(si.payoutAmount ?? 0),
        });
        annualPayment = annuityAmount;
        paymentLabel = "CLAT annuity payment to charity";
      } else {
        const { unitrustAmount } = computeAnnualUnitrustPayment({
          payoutPercent: Number(si.payoutPercent ?? 0),
          startOfYearFmv,
        });
        annualPayment = unitrustAmount;
        paymentLabel = "CLT unitrust payment to charity";
      }
      if (annualPayment <= 0) continue;

      creditCash(checkingId, -annualPayment, {
        category: "gift",
        label: paymentLabel,
        sourceId: trust.id,
      });
      cltCharitableOutflowsTotal += annualPayment;
      cltCharitableOutflowDetail.push({
        kind: "clt_payment",
        trustId: trust.id,
        trustName: trust.name ?? trust.id,
        charityId: si.charityId,
        amount: annualPayment,
        payoutType: si.payoutType === "annuity" ? "annuity" : "unitrust",
      });

      // Record the payment for cross-year recapture math. The death-year
      // payment IS counted in the PV per §170(f)(2)(B), so this push happens
      // before the recapture pass below for this same year.
      const existing = cltPaymentsByTrustId.get(trust.id) ?? [];
      existing.push(annualPayment);
      cltPaymentsByTrustId.set(trust.id, existing);
    }

    // ── CRT annual payment pass ───────────────────────────────────────────
    // Each year of a CRT's term, the trust pays either a fixed % of its BoY
    // FMV (CRUT) or a fixed annuity amount (CRAT) to the GRANTOR (household),
    // the opposite direction from a CLT. Per Spec A, the distribution is
    // taxed as ordinary income on the household 1040 (the §664(b) four-tier
    // characterization — ordinary, capital gain, tax-exempt, return-of-corpus
    // — is deferred to Spec B). NO §170(f)(2)(B) recapture applies on grantor
    // death; recapture is a CLT-only concept.
    for (const trust of currentEntities) {
      if (trust.trustSubType !== "crt" || !trust.splitInterest) continue;
      const si = trust.splitInterest;
      const yearsSinceInception = year - si.inceptionYear;
      if (yearsSinceInception < 0) continue;
      if (
        si.termType === "years" &&
        yearsSinceInception >= (si.termYears ?? 0)
      ) {
        continue;
      }
      // Life-based termination is handled in a later phase (Spec A ships
      // term-certain only).
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
      if (startOfYearFmv <= 0 && si.payoutType !== "annuity") continue;

      let annualPayment: number;
      let paymentLabel: string;
      if (si.payoutType === "annuity") {
        const { annuityAmount } = computeAnnualAnnuityPayment({
          payoutAmount: Number(si.payoutAmount ?? 0),
        });
        annualPayment = annuityAmount;
        paymentLabel = "CRAT annuity payment to grantor";
      } else {
        const { unitrustAmount } = computeAnnualUnitrustPayment({
          payoutPercent: Number(si.payoutPercent ?? 0),
          startOfYearFmv,
        });
        annualPayment = unitrustAmount;
        paymentLabel = "CRUT unitrust payment to grantor";
      }
      if (annualPayment <= 0) continue;

      // Debit the trust checking…
      creditCash(checkingId, -annualPayment, {
        category: "expense",
        label: paymentLabel,
        sourceId: trust.id,
      });
      // …and credit the household default checking.
      creditCash(defaultChecking?.id, annualPayment, {
        category: "income",
        label: paymentLabel,
        sourceId: trust.id,
      });
      householdTrustCashIn += annualPayment; // F8

      // Tag as ordinary income on the household 1040 with a stable per-trust
      // source key so report consumers can attribute it.
      taxDetail.ordinaryIncome += annualPayment;
      taxDetail.bySource[`crt_distribution:${trust.id}`] = {
        type: "ordinary_income",
        amount:
          (taxDetail.bySource[`crt_distribution:${trust.id}`]?.amount ?? 0) +
          annualPayment,
      };
    }

    // ── CLT trust-termination pass ────────────────────────────────────────
    // The year after a CLT's lead term ends, remaining trust assets are
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
      if (trust.trustSubType !== "clt" || !trust.splitInterest) continue;
      // Death-year extraction for life-based termination is deferred to
      // Tasks 11-12 when the death-event integration lands; until then,
      // term-certain ('years') CLTs are the only ones that terminate here.
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
          label: `CLT termination distribution`,
          sourceId: trust.id,
        });
      }
    }

    // ── CRT trust-termination pass ────────────────────────────────────────
    // The year after a CRT's lead term ends, remaining trust corpus goes to
    // the named CHARITY (the opposite of CLT, where remainder goes to
    // family). Cash exits the projection scope at termination; the
    // TrustTerminationResult is recorded for downstream report consumers.
    for (const trust of currentEntities) {
      if (trust.trustSubType !== "crt" || !trust.splitInterest) continue;
      if (!isTrustTerminationYear(trust, year, {})) continue;
      const si = trust.splitInterest;

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
        { recipientMode: "charity", charityId: si.charityId },
      );
      yearTrustTerminations.push(result);

      // Drain each trust account pro-rata.
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
          label: `CRT termination distribution to charity`,
          sourceId: trust.id,
        });
      }
    }

    // ── §170(f)(2)(B) recapture pass ──────────────────────────────────────
    // When a grantor of a CLT dies before the lead term ends, the unused
    // portion of the original income-interest deduction is recaptured as
    // ordinary income on the grantor's final 1040. Recapture =
    //   originalIncomeInterest − PV(actual payments) at the original §7520 rate.
    // Floored at 0.
    //
    // Recapture fires whenever the dying grantor's CLT income interest has NOT
    // yet terminated at death:
    //   - term-certain ('years' / 'shorter_of_years_or_life'): skip once the
    //     full term has elapsed (yearsElapsed >= termYears).
    //   - life-measured ('single_life' / 'joint_life'): skip ONLY when the
    //     measuring life(s) coincide with the dying grantor — then the death
    //     IS the term-end (no recapture). Treas. Reg. 1.170A-6(c)(4): when the
    //     measuring life is a THIRD party (e.g. a child) still alive at the
    //     grantor's death, the income interest is still running and the
    //     unrecovered deduction is recaptured.
    // In all cases, also skip if the trust has already terminated by this year.
    const decedentRoleThisYear: "client" | "spouse" | null =
      year === firstDeathYear
        ? firstDeathDeceased
        : year === finalDeathYear
          ? finalDeceased
          : null;
    if (decedentRoleThisYear != null) {
      // Household death years, by role, for the termination check below.
      // (The engine only tracks client/spouse deaths; a non-household
      //  measuring life — e.g. a child — has no death event and stays alive.)
      const clientDeathYear =
        firstDeathDeceased === "client"
          ? firstDeathYear
          : finalDeceased === "client"
            ? finalDeathYear
            : null;
      const spouseDeathYear =
        firstDeathDeceased === "spouse"
          ? firstDeathYear
          : finalDeceased === "spouse"
            ? finalDeathYear
            : null;
      const deathYearForFm = (fmId: string | null): number | undefined => {
        if (fmId == null) return undefined;
        if (fmId === clientFmId) return clientDeathYear ?? undefined;
        if (fmId === spouseFmId) return spouseDeathYear ?? undefined;
        return undefined;
      };
      for (const trust of currentEntities) {
        if (trust.trustSubType !== "clt" || !trust.splitInterest) continue;
        // Recapture iff deducted — the SAME predicate that gated the inception
        // deduction. A non-grantor CLT never took one, so there is nothing to
        // recapture and doing so would be phantom income. (F5)
        if (!grantorAtInception.get(trust.id)) continue;
        if (trust.grantor !== decedentRoleThisYear) continue;
        const si = trust.splitInterest;
        const grantorFmId =
          trust.grantor === "client" ? clientFmId : spouseFmId;
        const isYearsLeg =
          si.termType === "years" ||
          si.termType === "shorter_of_years_or_life";
        // True when the dying grantor's own life measures the lead term, so
        // the death coincides with term-end (no recapture). For joint_life
        // (last-to-die) the grantor being either measuring life counts.
        const measuredOnGrantor =
          grantorFmId != null &&
          (si.termType === "single_life"
            ? si.measuringLife1Id === grantorFmId
            : si.termType === "joint_life"
              ? si.measuringLife1Id === grantorFmId ||
                si.measuringLife2Id === grantorFmId
              : false);
        // Whether the trust's income interest is still running this year.
        const stillRunning = !isTrustTerminationYear(trust, year, {
          measuringLife1: deathYearForFm(si.measuringLife1Id),
          measuringLife2: deathYearForFm(si.measuringLife2Id),
        });
        if (isYearsLeg) {
          const yearsElapsed = year - si.inceptionYear + 1;
          if (yearsElapsed >= (si.termYears ?? 0)) continue;
        } else if (measuredOnGrantor || !stillRunning) {
          continue;
        }
        const payments = cltPaymentsByTrustId.get(trust.id) ?? [];
        const { recaptureAmount } = computeCltRecapture({
          originalIncomeInterest: Number(si.originalIncomeInterest),
          irc7520Rate: Number(si.irc7520Rate),
          paymentsByYearOffset: payments,
        });
        if (recaptureAmount > 0) {
          taxDetail.ordinaryIncome += recaptureAmount;
          taxDetail.bySource[`clt_recapture:${trust.id}`] = {
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
            age,
            acct.hsaCoverage
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

    // Household-grantor 529 contributions → state 529 deduction/credit input.
    // Derived from post-cap rule amounts (cappedByRuleId) prorated by the
    // partial-year gate factor, mirroring how applySavingsRules applies them.
    // NB: this is built BEFORE the savings pass runs (savings.byAccount at
    // ~4174), so we cannot use the applied-amount map here — we re-derive from
    // the same capped/prorated rule amounts the savings pass will use. External
    // grantors (no grantorFamilyMemberId) earn no household deduction. Keyed per
    // beneficiary (family-member id, else name, else account id) for
    // per_beneficiary-cap states.
    const contrib529: { total: number; byBeneficiary: number[] } | undefined =
      (() => {
        const byBeneficiary = new Map<string, number>();
        for (const rule of data.savingsRules) {
          const acct = accountById.get(rule.accountId);
          if (acct?.category !== "education_savings") continue;
          if (!acct.education529?.grantorFamilyMemberId) continue; // external grantor
          const gate = itemProrationGate(rule, year, data.client);
          if (!gate.include) continue;
          const amount =
            (cappedByRuleId[rule.id] ?? resolvedByRuleId[rule.id] ?? 0) * gate.factor;
          if (amount <= 0) continue;
          const key =
            acct.education529.beneficiaryFamilyMemberId ??
            acct.education529.beneficiaryName ??
            acct.id;
          byBeneficiary.set(key, (byBeneficiary.get(key) ?? 0) + amount);
        }
        if (byBeneficiary.size === 0) return undefined;
        const values = [...byBeneficiary.values()];
        return { total: values.reduce((s, v) => s + v, 0), byBeneficiary: values };
      })();

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
            rothPercent: r.rothPercent ?? null,
            startYear: r.startYear,
            endYear: r.endYear,
          })),
          data.accounts.map((a) => ({
            id: a.id,
            subType: a.subType ?? "",
            category: a.category,
            ownerEntityId: controllingEntity(a) ?? undefined,
          })),
          (entityId) => effectiveIsGrantor(entityId, year),
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
        if (subType !== "traditional_ira" && subType !== "401k" && subType !== "403b" && subType !== "hsa") continue;
        if (controllingEntity(acct) != null && !effectiveIsGrantor(controllingEntity(acct)!, year)) continue;
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
      if (inc.ownerEntityId != null && !effectiveIsGrantor(inc.ownerEntityId, year)) continue;
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
      ? (() => {
          const seca = calcSeca({
            seEarnings,
            ssTaxRate: resolved.params.ssTaxRate,
            ssWageBase: resolved.params.ssWageBase,
            medicareTaxRate: resolved.params.medicareTaxRate,
            ficaSsWages: taxDetail.earnedIncome,
          });
          // SE-side 0.9% Additional Medicare surtax (IRC §1401(b)(2)). Same
          // filing-status threshold source as the wage-side surtax in
          // calculate.ts (mfj / mfs / single, with HoH → single); wages
          // (taxDetail.earnedIncome) consume the threshold first so it's
          // applied exactly once across wage- and SE-sides.
          const addlMedicareThreshold =
            filingStatus === "married_joint"
              ? resolved.params.addlMedicareThreshold.mfj
              : filingStatus === "married_separate"
                ? resolved.params.addlMedicareThreshold.mfs
                : resolved.params.addlMedicareThreshold.single;
          const additionalMedicare = calcSeAdditionalMedicare({
            seEarnings,
            ficaSsWages: taxDetail.earnedIncome,
            threshold: addlMedicareThreshold,
            rate: resolved.params.addlMedicareRate,
          });
          return { ...seca, additionalMedicare };
        })()
      : { seTax: 0, deductibleHalf: 0, additionalMedicare: 0 };
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

    // Plan 4d-2 — CLT inception charitable deduction. The grantor takes the
    // present value of the lead interest as a "for the use of" charitable
    // contribution in the funding year (IRC §170(f)(2)(B)). AGI cap is 30%
    // (public charity) or 20% (private foundation), routed through the
    // appreciated buckets which encode those caps.
    for (const e of data.entities ?? []) {
      if (e.trustSubType !== "clt" || !e.splitInterest) continue;
      if (e.splitInterest.inceptionYear !== year) continue;
      // §170(f)(2)(B) is a GRANTOR-CLT deduction only. A non-grantor CLT deducts
      // each year's payment under §642(c) inside the 1041 pass instead
      // (nonGrantorTrustsWithDeductions) — granting both is a double
      // deduction. (F5)
      if (!grantorAtInception.get(e.id)) continue;
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

    // ── Household withdraw balances (hoisted: needed by both phase 5b
    // bracket-filler sizing and phase 12 supplemental / legacy-no-checking
    // gap-fill). Build unconditionally — the legacy no-checking path also
    // reads this map at line ~4095. T9: year-aware ownership — gift events
    // that transferred account ownership reduce the household's tappable
    // balance starting the gift's effective year.
    const householdWithdrawBalances: Record<string, number> = {};
    for (const acct of workingAccounts) {
      const householdShare = ownedByHouseholdAtYear(
        acct,
        data.giftEvents,
        year,
        planSettings.planStartYear,
      );
      if (householdShare <= 0) continue;
      if (acct.isDefaultChecking) continue;
      const balance = acct.id in accountBalances ? accountBalances[acct.id] : 0;
      // F3: a split-owned account's locked entity slice is untappable. Cap
      // household capacity at balance − Σ locked-so-far, computed with the
      // same roll-forward the EoY accrual books (carry + this year's growth
      // share, clamped at the current balance) so the cap and the accounting
      // can't drift. Without this the household re-derives capacity from the
      // raw balance every year and progressively spends trust principal.
      const wLedger = accountLedgers[acct.id];
      let lockedTotal = 0;
      for (const o of acct.owners) {
        if (o.kind !== "entity" || o.percent >= 1) continue;
        lockedTotal += accrueLockedEntityShare({
          carriedBoY: lockedEntityShareCarry.get(o.entityId)?.get(acct.id),
          ledger: {
            beginningValue: wLedger?.beginningValue ?? balance,
            growth: wLedger?.growth ?? 0,
            endingValue: balance,
          },
          percent: o.percent,
        }).lockedEoY;
      }
      householdWithdrawBalances[acct.id] =
        lockedTotal > 0
          ? Math.min(balance * householdShare, Math.max(0, balance - lockedTotal))
          : balance * householdShare;
    }

    // ── Roth Conversions — Phase 5b (size-only for fill_up_bracket) ─────────
    // `fill_up_bracket` sizing is deferred to phase 12's joint loop because
    // the supplemental withdrawal's recognized income (which also draws from
    // ordinary-income sources) needs to be jointly converged with the
    // conversion target. Other strategies (fixed/full/deplete) don't depend on
    // the supplemental side and apply immediately.
    const _isFillBracketActiveYear = (conv: RothConversion, yr: number): boolean => {
      if (yr < conv.startYear) return false;
      if (conv.endYear != null && yr > conv.endYear) return false;
      return true;
    };

    // Probe: returns this year's `incomeTaxBase` if Roth taxable income were
    // `r` and supplemental withdrawals contributed `(suppOrdinary, suppCapGains)`.
    // Captures the year-loop's tax inputs by closure so phase 12 can call it
    // each iteration with a fresh supplemental snapshot.
    const buildIncomeTaxBaseProbe = (): (
      (r: number, suppOrdinary?: number, suppCapGains?: number) => number
    ) => {
      return (r: number, suppOrdinary: number = 0, suppCapGains: number = 0): number => {
        if (!useBracket || !resolved) {
          return Math.max(0, taxableIncome + r + suppOrdinary + suppCapGains);
        }
        const trial = computeTaxForYear({
          taxDetail: {
            ...taxDetail,
            ordinaryIncome: taxDetail.ordinaryIncome + r + suppOrdinary,
            capitalGains: taxDetail.capitalGains + suppCapGains,
            bySource: { ...taxDetail.bySource },
          },
          socialSecurityGross: income.socialSecurity,
          totalIncome: income.total + r + suppOrdinary + suppCapGains,
          taxableIncome: taxableIncome + r + suppOrdinary + suppCapGains,
          filingStatus,
          year,
          planSettings: planSettingsForYear,
          resolved,
          useBracket,
          aboveLineDeductions,
          itemizedDeductions,
          charityCarryforwardIn: charityCarryforward,
          charityGiftsThisYear,
          secaResult,
          transferEarlyWithdrawalPenalty: 0,
          interestIncomeForTax,
          deductionBreakdownIn: deductionBreakdownResult ?? null,
          // primaryAge/spouseAge: senior deductions lower incomeTaxBase, which
          // sizes the conversion. retirementBreakdown is omitted — it feeds only
          // state exclusions (not this probe's federal incomeTaxBase) and is
          // declared after this closure's first call site (TDZ).
          primaryAge: ages.client,
          spouseAge: ages.spouse,
          isoSpread: equityIsoSpread,
        });
        return trial.taxResult.flow.incomeTaxBase;
      };
    };

    // Solve for the Roth taxable amount that lands `incomeTaxBase ≈ ceiling`
    // given a fixed supplemental snapshot. Bounded fixed-point — handles
    // non-linearities from SS taxability / QBI / piecewise deductions.
    const sizeFillBracketConversion = (
      ceiling: number,
      probe: ReturnType<typeof buildIncomeTaxBaseProbe>,
      suppOrdinary: number,
      suppCapGains: number,
    ): number => {
      const baseAt0 = probe(0, suppOrdinary, suppCapGains);
      if (baseAt0 >= ceiling) return 0;
      let target = ceiling - baseAt0;
      for (let i = 0; i < 6; i++) {
        const baseAtTarget = probe(target, suppOrdinary, suppCapGains);
        const delta = ceiling - baseAtTarget;
        if (Math.abs(delta) < 1) break;
        target = Math.max(0, target + delta);
      }
      return Math.max(0, target);
    };

    // Phase 5b: size-only. Splits conversions into bracket-fillers (deferred
    // to phase 12) and the rest (applied here).
    const pendingFillBracketTargets: Record<string, number> = {};
    const fillBracketCeilingsById: Record<string, number> = {};
    // Per-conversion fundable source-pool balance. A fill_up_bracket conversion
    // can never recognize more taxable income than its source accounts hold —
    // applyRothConversions caps the gross at this pool. Sizing/taxing beyond it
    // charges tax on a conversion that never happens (phantom income once the
    // source IRA is drained). Captured here at size time; the source accounts
    // are not debited again until the conversion is applied post-convergence.
    const fillBracketSourceCapById: Record<string, number> = {};
    let fillBracketProbe: ReturnType<typeof buildIncomeTaxBaseProbe> | null = null;
    const convFilingStatus = effectiveFilingStatus(
      (client.filingStatus ?? "single") as FilingStatus,
      firstDeathYear,
      year,
    );
    const convBrackets = taxResolver
      ? taxResolver.getYear(year)?.params.incomeBrackets[convFilingStatus]
      : undefined;
    const bracketFillerById = new Map<string, RothConversion>();

    if (data.rothConversions && data.rothConversions.length > 0) {
      const bracketFillers: RothConversion[] = [];
      const otherStrategies: RothConversion[] = [];
      for (const conv of data.rothConversions) {
        if (conv.enabled === false) continue;
        if (conv.conversionType === "fill_up_bracket") bracketFillers.push(conv);
        else otherStrategies.push(conv);
      }
      for (const conv of bracketFillers) bracketFillerById.set(conv.id, conv);

      if (otherStrategies.length > 0) {
        rothConversionResult = applyRothConversions({
          conversions: otherStrategies,
          accounts: workingAccounts,
          accountBalances,
          basisMap,
          rothValueMap,
          accountLedgers,
          year,
          ownerAges: { client: ages.client, spouse: ages.spouse },
          spouseFamilyMemberId: spouseFmId,
          ordinaryBrackets: convBrackets,
        });
        if (rothConversionResult.taxableOrdinaryIncome > 0) {
          taxableIncome += rothConversionResult.taxableOrdinaryIncome;
          taxDetail.ordinaryIncome += rothConversionResult.taxableOrdinaryIncome;
          for (const [cid, info] of Object.entries(rothConversionResult.byConversion)) {
            if (info.taxable > 0) {
              taxDetail.bySource[`roth_conversion:${cid}`] = {
                type: "ordinary_income",
                amount: info.taxable,
              };
            }
          }
        }
      }

      if (bracketFillers.length > 0 && convBrackets) {
        fillBracketProbe = buildIncomeTaxBaseProbe();
        for (const conv of bracketFillers) {
          if (!_isFillBracketActiveYear(conv, year)) continue;
          if (conv.fillUpBracket == null) continue;
          const tier = convBrackets.find(
            (t) => Math.abs(t.rate - conv.fillUpBracket!) < 1e-9,
          );
          if (!tier || tier.to == null) continue;
          const ceiling = tier.to - 1;
          fillBracketCeilingsById[conv.id] = ceiling;
          const sourceCap = conv.sourceAccountIds.reduce(
            (sum, sid) => sum + Math.max(0, accountBalances[sid] ?? 0),
            0,
          );
          fillBracketSourceCapById[conv.id] = sourceCap;
          pendingFillBracketTargets[conv.id] = Math.min(
            sizeFillBracketConversion(ceiling, fillBracketProbe, 0, 0),
            sourceCap,
          );
        }
      }
    }

    // ── Retirement breakdown for state income tax exclusions ─────────────────
    // Classify per-source ordinary income into the four state-exclusion buckets:
    //   db     = pension/deferred (Income.type === "deferred")
    //   ira    = traditional IRA distributions (subType = traditional_ira)
    //   k401   = 401k/403b distributions (subType = 401k | 403b)
    //   annuity = (no current account subType maps here; reserved for future use)
    // bySource keys: "<accountId>:rmd", "withdrawal:<accountId>", or "<incomeId>".
    // NOTE: this captures RMDs (+ any scheduled draws already in bySource) but NOT
    // the spending-driven supplemental IRA/401(k) draws — those are planned later
    // in the convergence loop and folded into `supplementalRetirementBreakdown`
    // there, so state exclusions apply to them too.
    const retirementBreakdown = { db: 0, ira: 0, k401: 0, annuity: 0 };
    {
      const incomeById = new Map(currentIncomes.map((inc) => [inc.id, inc]));
      for (const [key, entry] of Object.entries(taxDetail.bySource)) {
        if (entry.type !== "ordinary_income" || entry.amount <= 0) continue;
        const rmdMatch = key.match(/^([^:]+):rmd$/);
        const withdrawalMatch = key.match(/^withdrawal:(.+)$/);
        if (rmdMatch) {
          const acct = accountById.get(rmdMatch[1]);
          const sub = acct?.subType ?? "";
          if (sub === "traditional_ira") retirementBreakdown.ira += entry.amount;
          else if (sub === "401k" || sub === "403b") retirementBreakdown.k401 += entry.amount;
        } else if (withdrawalMatch) {
          const acct = accountById.get(withdrawalMatch[1]);
          const sub = acct?.subType ?? "";
          if (sub === "traditional_ira") retirementBreakdown.ira += entry.amount;
          else if (sub === "401k" || sub === "403b") retirementBreakdown.k401 += entry.amount;
        } else {
          // Income row keyed by incomeId
          const inc = incomeById.get(key);
          if (inc?.type === "deferred") retirementBreakdown.db += entry.amount;
        }
      }
    }

    const baseTaxInput: YearTaxInput = {
      taxDetail,
      socialSecurityGross: income.socialSecurity,
      totalIncome: income.total,
      taxableIncome,
      filingStatus,
      year,
      planSettings: planSettingsForYear,
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
      // NB: retirementBreakdown/primaryAge/spouseAge must stay in sync with the
      // YearTaxInput rebuilds in the supplemental-withdrawal loop below
      // (seededTaxInput, supplementalTaxInput) — the rebuilt input becomes the
      // stored taxResult, so omitting them silently drops the senior deductions.
      retirementBreakdown,
      contrib529,
      primaryAge: ages.client,
      spouseAge: ages.spouse,
      isoSpread: equityIsoSpread,
    };
    const taxOut = computeTaxForYear(baseTaxInput);

    // `taxes` is the pre-supplemental tax. The legacy no-checking path (else branch
    // in phase 12 below) uses it directly; the hasChecking path runs the convergence
    // loop and ends up with `finalTaxes` from `taxOutForIter` instead.
    const taxes = taxOut.taxes;
    // `charityCarryforward` and `deductionBreakdownResult` are reassigned AFTER the
    // convergence loop (phase 12 below) so iteration restarts each time from the
    // pre-this-year carryforward / breakdown values.

    // === Medicare / IRMAA computation ========================================
    // Computed here — before phase 6/7's cash routing — so the Medicare premium
    // can be debited from household checking like any other household expense
    // (and so the phase-12 supplemental-withdrawal convergence loop sizes the
    // gap-fill to cover it). IRMAA's canonical input is the year-(N-2) MAGI
    // lookback, which is already populated in `magiHistory` from prior loop
    // iterations and doesn't depend on this year's supplemental. Cold-start
    // years (the first 1-2 of a projection, before lookback history exists)
    // fall back to the per-person `priorYearMagi` override, then to this
    // year's PRE-supplemental MAGI estimate. The earlier placement is a slight
    // cold-start behavior change vs. using post-supplemental MAGI, but is
    // arguably more realistic: in practice households can't know their
    // supplemental needs in advance, and IRMAA tier shifts driven by a
    // one-time gap-fill withdrawal would be transient anyway. `magiHistory`
    // itself is set AFTER the convergence loop with the final post-supplemental
    // MAGI so future-year year-2 lookbacks remain accurate.
    //
    // Only fires when (a) at least one household member has a MedicareCoverage
    // row AND (b) the tax resolver has Medicare params seeded for this year —
    // otherwise the household has no Medicare model in scope and we skip.
    const medicareCoverageByOwner: Record<"client" | "spouse", MedicareCoverage | undefined> = {
      client: data.medicareCoverage?.find((c) => c.owner === "client"),
      spouse: data.medicareCoverage?.find((c) => c.owner === "spouse"),
    };
    const hasAnyCoverage = !!(medicareCoverageByOwner.client || medicareCoverageByOwner.spouse);
    const taxYearParams = resolved?.params;
    const medicareParamsReady =
      taxYearParams != null &&
      taxYearParams.standardPartBPremium != null &&
      taxYearParams.irmaaBracketsMfj != null &&
      taxYearParams.irmaaBracketsSingle != null;

    let medicareClient: MedicareYearDetail | undefined;
    let medicareSpouse: MedicareYearDetail | undefined;
    const medicarePreemptedExpenseIds = new Set<string>();

    if (hasAnyCoverage && medicareParamsReady) {
      const rawStandardPartB = Number(taxYearParams.standardPartBPremium ?? 0);
      const rawPartDBase = Number(taxYearParams.partDNationalBase ?? 0);
      const rawIrmaaMfj = (taxYearParams.irmaaBracketsMfj ?? []) as IrmaaTier[];
      const rawIrmaaSingle = (taxYearParams.irmaaBracketsSingle ?? []) as IrmaaTier[];
      // TODO(medicare-mfs): married_separate filers who lived with their spouse use a separate,
      // punitive IRMAA cliff structure under CMS rules. We currently bucket them as `single`,
      // which understates surcharges. Not fixed in this iteration — see future-work/engine.md.
      const irmaaFilingStatus: "mfj" | "single" =
        filingStatus === "married_joint" ? "mfj" : "single";

      // MAGI = AGI + tax-exempt interest (IRC §6334(d)(3)(C); IRMAA's MAGI def).
      // PRE-supplemental: uses `taxOut` (the initial tax compute) not the
      // post-convergence `finalTaxResult` because the convergence loop hasn't
      // run yet at this point in the year. Tax-exempt interest is unaffected
      // by supplemental withdrawals so reading it from the pre-loop taxDetail
      // is exact.
      const magiThisYearPreSupplemental =
        (taxOut.taxResult?.flow.adjustedGrossIncome ?? 0) +
        (taxDetail.taxExemptInterest ?? 0);

      // 2-year-lookback MAGI resolver. Real history (year - 2) takes precedence;
      // otherwise fall back to the per-person priorYearMagi override; otherwise
      // cold-start from this year's pre-supplemental MAGI as the least-bad
      // estimate.
      const resolveSourceMagi = (
        owner: "client" | "spouse",
      ): { magi: number; sourceYear: number; isColdStart: boolean } => {
        const lookbackYear = year - 2;
        const fromHistory = magiHistory.get(lookbackYear);
        if (fromHistory != null) {
          return { magi: fromHistory, sourceYear: lookbackYear, isColdStart: false };
        }
        const cov = medicareCoverageByOwner[owner];
        const override = cov?.estimatePriorYearMagiFromProjection ? null : cov?.priorYearMagi;
        if (override != null) {
          return { magi: override, sourceYear: year, isColdStart: true };
        }
        return { magi: magiThisYearPreSupplemental, sourceYear: year, isColdStart: true };
      };

      // Engine purity rule prevents importing from src/lib — these mirror
      // DEFAULT_MEDICARE_PREMIUM_INFLATION_RATE, DEFAULT_MEDIGAP_MONTHLY_AT_BASE_YEAR,
      // DEFAULT_PART_D_PLAN_MONTHLY_AT_BASE_YEAR, and DEFAULT_MEDICARE_BASE_YEAR
      // in src/lib/medicare/constants.ts.
      const inflationEnabled = data.medicarePremiumInflationEnabled ?? true;
      const rawInflationRate = data.medicarePremiumInflationRate ?? 0.03;
      const inflationRate = inflationEnabled ? rawInflationRate : 0;
      const medicareBaseYear = 2025;
      const defaultMedigapMonthly = 170;
      const defaultPartDPlanMonthly = 46;

      // Inflate Part B premium, Part D national base, and IRMAA bracket dollars
      // (surcharges + MAGI bounds) forward from the resolver's source year using
      // the Medicare-specific rate. CMS publishes new values each year — without
      // this, projections past the latest seeded year freeze Part B/IRMAA flat
      // even though Medigap/Part D plan portions already inflate inside
      // computeMedicareYear. Factor = 1 for exact-match years (source = year).
      const paramSourceYear = resolved?.sourceYear ?? year;
      const partBFactor = Math.pow(1 + inflationRate, Math.max(0, year - paramSourceYear));
      const standardPartBPremium = rawStandardPartB * partBFactor;
      const partDNationalBase = rawPartDBase * partBFactor;
      const inflateTiers = (tiers: IrmaaTier[]): IrmaaTier[] =>
        partBFactor === 1
          ? tiers
          : tiers.map((t) => ({
              tier: t.tier,
              magiLowerBound: t.magiLowerBound * partBFactor,
              magiUpperBound: t.magiUpperBound == null ? null : t.magiUpperBound * partBFactor,
              partBSurcharge: t.partBSurcharge * partBFactor,
              partDSurcharge: t.partDSurcharge * partBFactor,
            }));
      const irmaaTiersMfj = inflateTiers(rawIrmaaMfj);
      const irmaaTiersSingle = inflateTiers(rawIrmaaSingle);

      if (medicareCoverageByOwner.client) {
        const mc = resolveSourceMagi("client");
        medicareClient = computeMedicareYear({
          year,
          owner: "client",
          age: ages.client,
          coverage: medicareCoverageByOwner.client,
          standardPartBPremium,
          partDNationalBase,
          irmaaTiers: { mfj: irmaaTiersMfj, single: irmaaTiersSingle },
          filingStatus: irmaaFilingStatus,
          sourceMagi: mc.magi,
          sourceYearForIrmaa: mc.sourceYear,
          isColdStart: mc.isColdStart,
          medicareBaseYear,
          medicarePremiumInflationRate: inflationRate,
          defaultMedigapMonthly,
          defaultPartDPlanMonthly,
        });
      }

      if (ages.spouse !== undefined && medicareCoverageByOwner.spouse) {
        const mc = resolveSourceMagi("spouse");
        medicareSpouse = computeMedicareYear({
          year,
          owner: "spouse",
          age: ages.spouse,
          coverage: medicareCoverageByOwner.spouse,
          standardPartBPremium,
          partDNationalBase,
          irmaaTiers: { mfj: irmaaTiersMfj, single: irmaaTiersSingle },
          filingStatus: irmaaFilingStatus,
          sourceMagi: mc.magi,
          sourceYearForIrmaa: mc.sourceYear,
          isColdStart: mc.isColdStart,
          medicareBaseYear,
          medicarePremiumInflationRate: inflationRate,
          defaultMedigapMonthly,
          defaultPartDPlanMonthly,
        });
      }

      // Identify pre-Medicare expenses that need zeroing this year. The
      // `endsAtMedicareEligibilityOwner` flag marks expenses (typically
      // ACA/COBRA premiums) that should auto-end when the named owner enrolls.
      // We reuse computeMedicareYear's `enrolled` flag so the two notions of
      // "enrolled this year" stay in lockstep. Phase 7 below skips these IDs
      // so neither the cash debit nor the snapshot line carries them.
      const enrolledByOwner = {
        client: medicareClient?.enrolled ?? false,
        spouse: medicareSpouse?.enrolled ?? false,
      };
      for (const e of data.expenses) {
        const ownerKey = e.endsAtMedicareEligibilityOwner;
        if (!ownerKey) continue;
        if (!enrolledByOwner[ownerKey]) continue;
        medicarePreemptedExpenseIds.add(e.id);
      }
    }

    const medicareTotalAnnualCost =
      (medicareClient?.totalAnnualCost ?? 0) + (medicareSpouse?.totalAnnualCost ?? 0);
    const medicareTotalIrmaaSurcharge =
      (medicareClient?.partBIrmaaSurcharge ?? 0) +
      (medicareClient?.partDIrmaaSurcharge ?? 0) +
      (medicareSpouse?.partBIrmaaSurcharge ?? 0) +
      (medicareSpouse?.partDIrmaaSurcharge ?? 0);

    const medicareYearData =
      medicareClient || medicareSpouse
        ? {
            client: medicareClient,
            spouse: medicareSpouse,
            totalAnnualCost: medicareTotalAnnualCost,
            totalIrmaaSurcharge: medicareTotalIrmaaSurcharge,
          }
        : undefined;
    // === End Medicare / IRMAA ===============================================

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
      // Business-owned income (ownerAccountId set) is routed via the Phase 3
      // business-distribution loop below, not the household cash routing here.
      // Without this guard the row is credited twice: once to defaultChecking
      // via resolveCashAccount (since ownerEntityId is null), and again as
      // part of the business-distribution sweep.
      if (inc.ownerAccountId != null) continue;
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
        basis: amount, // cash deposit: basis == amount
      });
    }

    // 7. Route each expense as an outflow from its cash account.
    for (const exp of allExpenses) {
      const expRouteGate = itemProrationGate(exp, year, data.client);
      if (!expRouteGate.include) continue;
      // Business-owned expense (ownerAccountId set) is paid out of business cash
      // and netted against business income in the Phase 3 distribution loop —
      // not paid from household cash here. Without this guard the row is
      // debited twice: once from defaultChecking via resolveCashAccount, and
      // again implicitly when the Phase 3 sweep nets it against gross income.
      if (exp.ownerAccountId != null) continue;
      // Education goals are routed by applyEducationFunding (dedicated draw +
      // optional out-of-pocket spill), not as a plain cash outflow here.
      if (exp.type === "education") continue;
      // Medicare-preempted expenses (e.g. ACA/COBRA flagged
      // endsAtMedicareEligibilityOwner) are replaced by the modeled Medicare
      // premium debit below. Skip both the cash debit AND the snapshot line
      // (the latter is removed in the post-build snapshot patch). Without this
      // skip the household pays both the preempted expense AND Medicare,
      // double-counting the health-insurance cost.
      if (medicarePreemptedExpenseIds.has(exp.id)) continue;
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
        basis: -amount, // cash outflow: basis == amount (signed)
      });
    }

    // 7a. Medicare premium debit. Computed early (see the Medicare block above
    // phase 6) so we can pay it from household checking like any other
    // household expense. This way preSupplementalChecking reflects the
    // Medicare draw, and the phase-12 convergence loop sizes the supplemental
    // gap-fill to cover it.
    if (medicareTotalAnnualCost > 0) {
      creditCash(defaultChecking?.id, -medicareTotalAnnualCost, {
        category: "expense",
        label: "Medicare premiums",
        sourceId: "medicarePremiums",
        basis: -medicareTotalAnnualCost, // cash outflow: basis == amount (signed)
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
      const ovr = entityFlowOverrideByKey.get(`${entity.id}:${year}`);
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

    // ── Phase 3: business-account distribution to household ───────────────
    // After income/expense crediting on the business's child cash account,
    // sweep net income to household checking per the business's
    // distributionPolicyPercent.
    //
    // Grantor / family-owned businesses are included unconditionally: tax
    // pass-through (handled in the Phase 3 tax block above) is orthogonal to
    // cash pass-through. Without this, cash earned by a business would strand
    // in its checking forever even when the user sets a 100% distribution
    // policy.
    //
    // Per spec § Phase 3 decisions:
    //   P3-4: same year, audit category "entity_distribution"
    //   P3-5: null distributionPolicyPercent defaults to 1.0
    //   P3-7: target is the primary family-member owner's default cash; else
    //         household defaultChecking
    //   P3-8: losses → no distribution (skip net ≤ 0)
    for (const business of businessAccountsThisYear) {
      const flow = computeBusinessYearFlow(
        business,
        year,
        currentIncomes,
        allExpenses,
        data.accountFlowOverrides,
      );
      const netIncome = flow.gross - flow.exp;
      // Source: the business's own child cash account if one exists. When the
      // business has no child cash bucket (default state — creation doesn't
      // auto-provision one), the debit side is skipped and net income flows
      // directly from the business to the owner. The (1 - distPercent)
      // retained share has nowhere to land in that mode and is dropped — the
      // user must add a child cash account to model retained earnings.
      const businessCash = data.accounts.find(
        (a) =>
          a.parentAccountId === business.id &&
          a.category === "cash" &&
          a.isDefaultChecking === true,
      );

      // Record the business's own gross income and expenses on its cash
      // account so it holds the business's true balance (retained earnings
      // after the distribution below). Without this the account's only entry
      // was the distribution debit, so it spiralled negative — distributing
      // money it never received. Losses are posted too: a loss drives
      // businessCash negative and step 12c's per-entity gap-fill liquidates the
      // business's own liquid holdings (or emits `entity_overdraft` when none
      // remain) — the same treatment household checking gets.
      if (businessCash) {
        if (flow.gross !== 0) {
          creditCash(businessCash.id, flow.gross, {
            category: "income",
            label: `Income: ${business.name}`,
            sourceId: business.id,
          });
        }
        if (flow.exp !== 0) {
          creditCash(businessCash.id, -flow.exp, {
            category: "expense",
            label: `Expenses: ${business.name}`,
            sourceId: business.id,
          });
        }
      }

      // Distribution: only profitable businesses distribute (P3-8: losses → no
      // distribution).
      if (netIncome <= 0) continue;
      const distAmount = netIncome * flow.distPercent;
      if (distAmount === 0) continue;
      // Destination: primary family-member owner's default cash account.
      // Falls back to household defaultChecking when the business has no
      // family owners or the owner has no associated cash account.
      const primaryOwner = business.owners
        .filter((o) => o.kind === "family_member")
        .slice()
        .sort((x, y) => y.percent - x.percent)[0];
      const destinationId =
        (primaryOwner
          ? resolveFamilyMemberDefaultCash(primaryOwner.familyMemberId)
          : undefined) ?? defaultChecking?.id;
      // Debit business cash (only if it exists)
      if (businessCash) {
        creditCash(businessCash.id, -distAmount, {
          category: "entity_distribution",
          label: `Distribution from ${business.name}`,
          sourceId: business.id,
          counterpartyId: destinationId, // distributed to the owner's cash account
        });
      }
      // Credit owner's default cash account
      creditCash(destinationId, distAmount, {
        category: "entity_distribution",
        label: `Distribution from ${business.name}`,
        sourceId: business.id,
        counterpartyId: business.id, // received from the business
      });
    }

    // ── Phase 3 (entity model): EntitySummary business distribution ──────────
    // Account-model counterpart of the loop above, for businesses modeled as
    // EntitySummary rows (entityType llc|s_corp|c_corp|partnership|foundation|
    // other) rather than top-level business *accounts*. Their income/expense
    // already landed on the entity's own checking via resolveCashAccount in the
    // income/expense routing above (ownerEntityId rows). Without this sweep the
    // net income strands in entity checking forever, annualDistribution is
    // structurally 0, and the entity's value/basis overstate every year
    // (BUG #17). Same mechanics as the account-model sweep: debit the entity's
    // cash account, credit the primary family-member owner's default cash
    // (else household defaultChecking). Trusts use the 1041/grantor passes and
    // are excluded.
    for (const entity of currentEntities) {
      if (entity.entityType === "trust") continue;
      const flowMode = entity.flowMode ?? "annual";
      const netIncome = computeBusinessEntityNetIncome(
        entity.id,
        currentIncomes,
        allExpenses,
        year,
        data.entityFlowOverrides ?? [],
        flowMode,
        data.client,
      );
      // Losses → no distribution (P3-8). The loss stays in the entity's
      // checking (and is liquidated / overdrafted by the per-entity gap-fill,
      // same as the account model).
      if (netIncome <= 0) continue;
      const distPercent = resolveDistributionPercent(
        entity,
        year,
        data.entityFlowOverrides ?? [],
      );
      const distAmount = netIncome * distPercent;
      if (distAmount === 0) continue;
      // Destination: primary family-member owner's default cash account, else
      // household defaultChecking — mirrors the account-model resolution.
      const primaryOwner = (entity.owners ?? [])
        .filter((o) => o.kind === "family_member")
        .slice()
        .sort((x, y) => y.percent - x.percent)[0] as
        | { kind: "family_member"; familyMemberId: string; percent: number }
        | undefined;
      const destinationId =
        (primaryOwner
          ? resolveFamilyMemberDefaultCash(primaryOwner.familyMemberId)
          : undefined) ?? defaultChecking?.id;
      const entityCashId = resolveCashAccount(entity.id);
      // Debit the entity's cash account (only if one exists — without it the
      // retained share has nowhere to land and the credit flows straight from
      // entity to owner, same as the account model's no-child-cash mode).
      if (entityCashId) {
        creditCash(entityCashId, -distAmount, {
          category: "entity_distribution",
          label: `Distribution from ${entity.name ?? "Entity"}`,
          sourceId: entity.id,
          counterpartyId: destinationId,
        });
      }
      // Credit owner's default cash account.
      creditCash(destinationId, distAmount, {
        category: "entity_distribution",
        label: `Distribution from ${entity.name ?? "Entity"}`,
        sourceId: entity.id,
        counterpartyId: entity.id,
      });
    }

    // 8. Liability payments settle against the owning party's cash account —
    // pro-rated by ownership share. Household share leaves household checking;
    // each entity owner's share leaves that entity's checking.
    // T9: use year-aware liabilityOwnersForYear so gift events that transferred
    // liability ownership to an entity route debt service to the entity's checking
    // starting the year the gift fires.
    // C1: iterate currentLiabilities (not the static data.liabilities) so
    // purchase-created synthetic mortgages (technique-liab-*) — which are absent
    // from data.liabilities but present in liabResult.byLiability / the P&L total
    // — actually have their payment debited from cash. Removed liabilities are
    // harmless: byLiability lacks them, so payment is 0 and the loop continues.
    for (const liab of currentLiabilities) {
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
          basis: -payment * householdShare, // cash outflow: basis == amount (signed)
        });
      }
      for (const owner of liabYearOwners) {
        if (owner.kind !== "entity") continue;
        if (owner.percent <= 0) continue;
        creditCash(resolveCashAccount(owner.entityId), -payment * owner.percent, {
          category: "liability",
          label: `Liability: ${liab.name}`,
          sourceId: liab.id,
          basis: -payment * owner.percent, // cash outflow: basis == amount (signed)
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
          normalSavingsRules,
          year,
          income.salaries,
          data.client,
          undefined,
          salaryByRuleId,
          cappedByRuleId
        )
      : applySavingsRules(
          normalSavingsRules,
          year,
          income.salaries,
          data.client,
          Math.max(0, surplusBeforeSavings),
          salaryByRuleId,
          cappedByRuleId
        );

    // Credit employee contributions to destination accounts and debit household checking.
    // A 529 funded by an OUTSIDE grantor (education_savings account whose
    // education529.grantorFamilyMemberId is null/undefined — e.g. a grandparent)
    // still receives its contribution as an account credit, but the money is a
    // gift arriving from outside the plan: household checking is NOT debited
    // (same shape as an employer match). Household-grantor 529s keep the
    // existing behavior — checking is debited.
    let householdFundedTotal = savings.total;
    for (const [acctId, amount] of Object.entries(savings.byAccount)) {
      if (notYetActive.has(acctId)) continue; // pre-activation account: no contributions yet
      if (amount === 0) continue;
      const dest = accountById.get(acctId);
      const externallyFunded =
        dest?.category === "education_savings" &&
        !dest.education529?.grantorFamilyMemberId;
      if (externallyFunded) householdFundedTotal -= amount;
      accountBalances[acctId] = (accountBalances[acctId] ?? 0) + amount;
      if (accountLedgers[acctId]) {
        accountLedgers[acctId].contributions += amount;
        accountLedgers[acctId].endingValue += amount;
        const destName = dest?.name ?? "account";
        accountLedgers[acctId].entries.push({
          category: "savings_contribution",
          label: `Contribution to ${destName}`,
          amount,
          sourceId: acctId,
          basis: 0, // pre-tax 401k/403b contribution carries no cost basis
          // Externally-funded 529: money came from outside the plan, so there is
          // no household-cash counterparty to reconcile against.
          counterpartyId: externallyFunded ? undefined : defaultChecking?.id,
        });
      }
    }
    creditCash(defaultChecking?.id, -householdFundedTotal, {
      category: "savings_contribution",
      label: "Savings contributions",
      basis: -householdFundedTotal, // cash outflow: basis conserves 1:1 with amount
    });

    // ── Education goals: dedicated funding pass ──────────────────────────────
    // Dedicated accounts already have this year's growth (step 4) and savings
    // contributions applied. Draw each active goal's indexed cost from its
    // dedicated accounts in order; 529 draws are tax-free (categorizeDraw).
    // Uncovered cost is a shortfall, paid from household cash only when
    // payShortfallOutOfPocket is set. This runs BEFORE `baselineTaxDetail` is
    // snapshotted (below) so any taxable draw components (non-529 dedicated
    // accounts) reach the year's tax convergence; and BEFORE the step-11
    // cashDelta flush so an out-of-pocket spill lands on checking this year.
    // Tax-free retirement slice (qualified Roth, 401k/403b Roth share, HSA) of a
    // supplemental or education draw — display-only nonTaxableIncome. Taxable/cash
    // (and 529) draws excluded: their untaxed share is return of principal, not
    // income. Shared by the education pass below and the supplemental loop later.
    const taxFreeRetirementSlice = (draw: SupplementalDraw): number =>
      accountById.get(draw.accountId)?.category === "retirement"
        ? Math.max(0, draw.amount - draw.ordinaryIncome)
        : 0;
    const sumTaxFreeSlice = (draws: SupplementalDraw[]): number =>
      draws.reduce((sum, d) => sum + taxFreeRetirementSlice(d), 0);

    // R4: non-taxable retirement income from Roth/HSA education draws, accumulated
    // across goals and folded into taxFreeRetirementIncome (same as supplemental).
    let educationTaxFreeIncome = 0;

    const educationGoalYears: EducationGoalYear[] = [];
    for (const { goal, gate } of educationGoalsThisYear) {
      const inflateFrom = goal.inflationStartYear ?? goal.startYear;
      const rawCost = goal.scheduleOverrides
        ? (goal.scheduleOverrides[year] ?? 0)
        : goal.annualAmount * Math.pow(1 + goal.growthRate, year - inflateFrom);
      const goalCost = rawCost * gate.factor;

      const ids = goal.dedicatedAccountIds ?? [];
      const boy = ids.reduce((s, id) => s + (eduBoyBalances[id] ?? 0), 0);

      const drawResult = computeEducationDraw({
        goalCost,
        dedicatedAccountIds: ids,
        balances: accountBalances,
        categorize: (id, amount) => {
          const acct = accountById.get(id);
          if (!acct) {
            return { ordinaryIncome: 0, capitalGains: 0, basisReturn: amount, earlyWithdrawalPenalty: 0 };
          }
          const ownerAge =
            isSpouseAccount(acct) && ages.spouse != null ? ages.spouse : ages.client;
          const { ordinaryIncome, capitalGains, basisReturn, earlyWithdrawalPenalty } =
            categorizeDraw({
              account: acct,
              amount,
              balance: accountBalances[id] ?? 0,
              basisMap,
              rothValueMap,
              ownerAge,
            });
          return { ordinaryIncome, capitalGains, basisReturn, earlyWithdrawalPenalty };
        },
      });

      // Apply the draws to balances + ledgers. Money leaves the plan to the
      // school — it does NOT credit household checking.
      for (const d of drawResult.draws) {
        accountBalances[d.accountId] = (accountBalances[d.accountId] ?? 0) - d.amount;
        // A taxable draw returns basis; reduce the source's basisMap so a later
        // sale doesn't re-tax the same dollars. The ledger entry must book the
        // CLAMPED delta (what basisMap actually shed) so the asset-ledger
        // reconciliation identity basisEoY − basisBoY = Σ entry.basis holds for
        // appreciated 529s where basisReturn (== draw amount) exceeds tracked basis.
        const basisBefore = basisMap[d.accountId] ?? 0;
        const entryBasisDelta = d.basisReturn > 0 ? -Math.min(d.basisReturn, basisBefore) : 0;
        if (d.basisReturn > 0) {
          basisMap[d.accountId] = Math.max(0, basisBefore - d.basisReturn);
        }
        const led = accountLedgers[d.accountId];
        if (led) {
          led.distributions += d.amount;
          led.endingValue -= d.amount;
          led.entries.push({
            category: "withdrawal",
            label: `Education: ${goal.name}`,
            amount: -d.amount,
            sourceId: goal.id,
            basis: entryBasisDelta,
          });
        }
      }

      // Taxable components feed the year's tax (mostly zero — 529 is tax-free).
      if (drawResult.ordinaryIncome > 0) taxDetail.ordinaryIncome += drawResult.ordinaryIncome;
      if (drawResult.capitalGains > 0) taxDetail.capitalGains += drawResult.capitalGains;
      if (drawResult.ordinaryIncome > 0 || drawResult.capitalGains > 0) {
        taxDetail.bySource[`education:${goal.id}`] = {
          type: drawResult.capitalGains > 0 ? "capital_gains" : "ordinary_income",
          amount: drawResult.capitalGains > 0 ? drawResult.capitalGains : drawResult.ordinaryIncome,
        };
      }

      // R4: a Roth/HSA dedicated account surfaces its untaxed slice as non-taxable
      // retirement income — the same treatment a supplemental Roth/HSA draw gets.
      // 529/taxable draws contribute 0 (return of principal, not income).
      const eduTaxFree = sumTaxFreeSlice(drawResult.draws);
      if (eduTaxFree > 0) {
        taxDetail.bySource[`education_tax_free:${goal.id}`] = { type: "tax_free", amount: eduTaxFree };
        educationTaxFreeIncome += eduTaxFree;
      }

      // Out-of-pocket: spill the shortfall to household cash (→ normal
      // waterfall via the step-11 cashDelta flush + phase-12 gap-fill).
      if (goal.payShortfallOutOfPocket && drawResult.shortfall > 0) {
        creditCash(resolveCashAccount(goal.ownerEntityId, goal.cashAccountId), -drawResult.shortfall, {
          category: "expense",
          label: `Education (out of pocket): ${goal.name}`,
          sourceId: goal.id,
          basis: -drawResult.shortfall, // cash outflow: basis == amount (signed)
        });
      }

      const eoy = ids.reduce((s, id) => s + (accountBalances[id] ?? 0), 0);
      const growthAndSavings = ids.reduce((s, id) => {
        const led = accountLedgers[id];
        return s + (led ? led.growth + led.contributions : 0);
      }, 0);
      // otherExpenseFlows = residual (any non-goal balance change), keeping the
      // invariant BOY + G&S − dedicatedWithdrawal − otherExpenseFlows = EOY.
      const otherExpenseFlows = boy + growthAndSavings - drawResult.dedicatedWithdrawal - eoy;

      // The gap not covered by dedicated funds is either FUNDED from cash flow
      // (out-of-pocket, above) or genuinely unfunded (shortfall) — never both.
      const outOfPocketWithdrawal = goal.payShortfallOutOfPocket ? drawResult.shortfall : 0;
      const shortfall = goal.payShortfallOutOfPocket ? 0 : drawResult.shortfall;

      educationGoalYears.push({
        goalId: goal.id,
        dedicatedAssetsBOY: boy,
        growthAndSavings,
        goalExpense: goalCost,
        otherExpenseFlows,
        dedicatedWithdrawal: drawResult.dedicatedWithdrawal,
        outOfPocketWithdrawal,
        dedicatedAssetsEOY: eoy,
        shortfall,
      });
    }

    // ── 529 → Roth rollovers (SECURE 2.0 §126) ───────────────────────────────
    // Leftover 529 balances roll to the beneficiary's Roth IRA, capped at the
    // annual IRA limit and a $35,000 lifetime allowance (tracked cross-year in
    // rolled529ByAccount). Tax-free: the transfer books no ordinary income. The
    // 15-year account-age gate and earned-income limit are out of scope (v1).
    if (taxYearParams) {
      for (const acct of data.accounts) {
        const cfg = acct.category === "education_savings" ? acct.education529 : undefined;
        if (!cfg?.rothRolloverEnabled) continue;
        if (cfg.rothRolloverStartYear != null && year < cfg.rothRolloverStartYear) continue;
        const balance = accountBalances[acct.id] ?? 0;
        if (balance <= 0) continue;
        // Beneficiary age drives the IRA limit; an unknown DOB falls back to
        // age 30 (catch-up-free base limit).
        const benefDob = data.familyMembers?.find(
          (fm) => fm.id === cfg.beneficiaryFamilyMemberId,
        )?.dateOfBirth;
        const benefAge = benefDob ? resolveAgeInYear(benefDob, year) : 30;
        const { amount } = computeRoth529Rollover({
          balance,
          lifetimeRolledSoFar: rolled529ByAccount[acct.id] ?? 0,
          annualIraLimit: computeIraLimit(taxYearParams, benefAge),
        });
        if (amount <= 0) continue;
        rolled529ByAccount[acct.id] = (rolled529ByAccount[acct.id] ?? 0) + amount;
        accountBalances[acct.id] = balance - amount;
        // 529 basis (contributions) shrinks 1:1 with the withdrawal; book the
        // clamped delta so basisEoY − basisBoY = Σ entry.basis still holds.
        const srcBasisBefore = basisMap[acct.id] ?? 0;
        const srcBasisDelta = -Math.min(amount, srcBasisBefore);
        basisMap[acct.id] = Math.max(0, srcBasisBefore + srcBasisDelta);
        const srcLed = accountLedgers[acct.id];
        if (srcLed) {
          srcLed.distributions += amount;
          srcLed.endingValue -= amount;
          srcLed.entries.push({
            category: "withdrawal",
            label: "529 → Roth IRA rollover",
            amount: -amount,
            sourceId: acct.id,
            basis: srcBasisDelta,
            counterpartyId: cfg.rothRolloverAccountId ?? undefined,
          });
        }
        // Destination: a household Roth IRA receives the funds as Roth basis.
        // No destination (external beneficiary) → funds exit the plan; the
        // source-leg ledger entry is the only record.
        const dest = cfg.rothRolloverAccountId
          ? accountById.get(cfg.rothRolloverAccountId)
          : undefined;
        if (dest && dest.subType === "roth_ira") {
          accountBalances[dest.id] = (accountBalances[dest.id] ?? 0) + amount;
          basisMap[dest.id] = (basisMap[dest.id] ?? 0) + amount; // lands as Roth basis
          const destLed = accountLedgers[dest.id];
          if (destLed) {
            destLed.contributions += amount;
            destLed.endingValue += amount;
            destLed.entries.push({
              category: "savings_contribution",
              label: "Rollover from 529",
              amount,
              sourceId: acct.id,
              basis: amount,
              counterpartyId: acct.id,
            });
          }
        }
      }
    }

    // ── Education goals: pre-expense accumulation pass ───────────────────────
    // For each goal that is not yet active (a funding-runway year before its
    // startYear), emit a row so the report chart/table show the dedicated funds
    // growing and any contributions made. There is no draw here — goalExpense,
    // dedicatedWithdrawal and shortfall are 0. A row is emitted only once the
    // dedicated pool is first funded (balance > 0 or a contribution landed),
    // so the chart starts at first dedicated funding. Post-expense trailing
    // years (year ≥ startYear but inactive) are intentionally excluded.
    for (const { goal, gate } of allEducationGoals) {
      if (gate.include) continue; // active goals handled above
      if (year >= goal.startYear) continue; // only lead-up (pre-start) years
      const ids = goal.dedicatedAccountIds ?? [];
      if (ids.length === 0) continue;

      const boy = ids.reduce((s, id) => s + (eduBoyBalances[id] ?? 0), 0);
      const eoy = ids.reduce((s, id) => s + (accountBalances[id] ?? 0), 0);
      const growthAndSavings = ids.reduce((s, id) => {
        const led = accountLedgers[id];
        return s + (led ? led.growth + led.contributions : 0);
      }, 0);
      if (boy <= 0 && growthAndSavings <= 0) continue; // not yet funded → no row

      educationGoalYears.push({
        goalId: goal.id,
        dedicatedAssetsBOY: boy,
        growthAndSavings,
        goalExpense: 0,
        // residual keeps BOY + G&S − withdrawal − otherExpenseFlows = EOY.
        otherExpenseFlows: boy + growthAndSavings - eoy,
        dedicatedWithdrawal: 0,
        outOfPocketWithdrawal: 0,
        dedicatedAssetsEOY: eoy,
        shortfall: 0,
        accumulation: true,
      });
    }

    // Self-funding hypothetical savings (Retirement Analysis "Minimum Additional
    // Savings"). For each self-funding rule, deposit the FULL prorated annual
    // amount into its taxable account, funded first from this year's positive net
    // cash flow (after normal savings) and then by reducing living expenses. Never
    // touches the withdrawal strategy. See spec
    // 2026-05-30-retirement-min-savings-redesign-design.
    let hypoContribution = 0;
    let hypoFromCashFlow = 0;
    let hypoFromExpenseReduction = 0;
    if (selfFundingRules.length > 0) {
      // Cash flow available to the hypothetical = only the share of surplus the
      // household would otherwise SPEND (phase 14's discretionary split). The
      // retained share is already invested in the portfolio, so funding the
      // hypothetical from it would merely relocate cash (checking → brokerage),
      // adding no new money — leaving PoS flat and the min-savings goal-seek
      // "unreachable" however high the lever. Only spent-but-now-redirected cash
      // (and expense cuts below) genuinely raise the portfolio. Mirror phase 14's
      // clamp of surplusSpendPct (default 0 ⇒ fund entirely from expense cuts).
      const selfFundingSpendPct = Math.min(1, Math.max(0, data.planSettings.surplusSpendPct ?? 0));
      let surplusAvailable =
        Math.max(0, surplusBeforeSavings - savings.total) * selfFundingSpendPct;
      // Living expense pool still available to cut this year.
      let livingAvailable = Math.max(0, expenseBreakdown.living);
      for (const rule of selfFundingRules) {
        if (notYetActive.has(rule.accountId)) continue; // pre-activation account: no contributions yet
        const gate = itemProrationGate(rule, year, data.client);
        if (!gate.include) continue;
        const target = rule.annualAmount * gate.factor;
        if (target <= 0) continue;
        const fromCash = Math.min(target, surplusAvailable);
        const fromCut = Math.min(target - fromCash, livingAvailable);
        const actual = fromCash + fromCut;
        if (actual <= 0) continue;
        surplusAvailable -= fromCash;
        livingAvailable -= fromCut;
        hypoContribution += actual;
        hypoFromCashFlow += fromCash;
        hypoFromExpenseReduction += fromCut;

        // Deposit into the taxable account; post-tax dollars → bump basis so
        // contributions aren't re-taxed on withdrawal. Growth is taxed annually
        // later via acct.realization.
        accountBalances[rule.accountId] = (accountBalances[rule.accountId] ?? 0) + actual;
        basisMap[rule.accountId] = (basisMap[rule.accountId] ?? 0) + actual;
        if (accountLedgers[rule.accountId]) {
          accountLedgers[rule.accountId].contributions += actual;
          accountLedgers[rule.accountId].endingValue += actual;
          accountLedgers[rule.accountId].entries.push({
            category: "savings_contribution",
            label: "Hypothetical additional savings",
            amount: actual,
            sourceId: rule.accountId,
            basis: actual, // post-tax dollars: basis bumps by the full contribution
            counterpartyId: defaultChecking?.id, // funded from household cash flow
          });
        }
      }
      // Net cash drain on checking is ONLY the cash-flow portion; the expense-cut
      // portion represents money not spent, so it stays in checking.
      creditCash(defaultChecking?.id, -hypoFromCashFlow, {
        category: "savings_contribution",
        label: "Hypothetical additional savings (cash flow)",
        basis: -hypoFromCashFlow, // cash outflow: basis conserves 1:1 with amount
      });
    }

    // Roth-designated slice of employee 401(k)/403(b) contributions feeds the
    // account's Roth basis so it is tax-free on later withdrawal / conversion.
    // Gated on subtype — rothPercent is only meaningful for deferral accounts.
    for (const [acctId, rothAmount] of Object.entries(savings.rothByAccount)) {
      if (rothAmount === 0) continue;
      const acct = accountById.get(acctId);
      if (acct?.subType !== "401k" && acct?.subType !== "403b") continue;
      rothValueMap[acctId] = (rothValueMap[acctId] ?? 0) + rothAmount;
    }

    // Employer match — direct credit to the destination account, free cash from the
    // employer. Does not touch household checking. Unlike employee contributions,
    // the match must be computed against *only* the account owner's salary — a
    // spouse's salary can't ground the other spouse's 401k match. Joint-owned or
    // orphaned-rule accounts get no match (no individual salary to base it on).
    for (const rule of normalSavingsRules) {
      if (notYetActive.has(rule.accountId)) continue; // pre-activation account: no match yet
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
          basis: 0, // pre-tax employer contribution carries no cost basis
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

      // Resolve recipient: a modeled trust entity's default checking. Gifts to
      // family members / external beneficiaries (recipientEntityId absent) — or
      // to a trust with no checking account configured — have no in-projection
      // account to credit; the cash simply leaves the household. The source is
      // still debited below regardless.
      const recipientId = gift.recipientEntityId
        ? entityCheckingByEntityId[gift.recipientEntityId]
        : undefined;
      const recipientName = gift.recipientEntityId
        ? currentEntities.find((e) => e.id === gift.recipientEntityId)?.name ?? gift.recipientEntityId
        : "recipient";

      creditCash(sourceId, -gift.amount, {
        category: "gift",
        label: `Cash gift to ${recipientName}`,
        sourceId: gift.recipientEntityId,
        basis: -gift.amount, // cash outflow: basis == amount (signed)
        counterpartyId: gift.recipientEntityId, // money went to the recipient
      });
      // Credit the recipient only when it's a modeled entity with a checking
      // account; otherwise the cash exits the projection.
      if (recipientId) {
        creditCash(recipientId, gift.amount, {
          category: "gift",
          label: `Cash gift received`,
          sourceId: gift.recipientEntityId,
          basis: gift.amount, // cash deposit: basis == amount
          counterpartyId: sourceId, // money came from the gift source account
        });
      }

      // Surface household-side outflows on the cashflow report. Counted only
      // when the source is a household-owned account; gifts originating from
      // entity-owned accounts (e.g. trust → charity) drain the entity, not the
      // household portfolio.
      const sourceAccount = data.accounts.find((a) => a.id === sourceId);
      if (sourceAccount && !isFullyEntityOwned(sourceAccount)) {
        householdCashGiftsTotal += gift.amount;
      }
    }

    // 10c. Surplus allocation (H5) is deferred to phase 14 (after the
    // supplemental-tax convergence loop and the technique fold) so the split is
    // sized from the SAME resolved Net Cash Flow the cash-flow report displays —
    // i.e. including notes-receivable cash-in, technique sale proceeds / purchase
    // equity, synthetic property tax, and the final converged tax. The legacy
    // step here sized it from `surplusBeforeSavings`, which omits all of those,
    // so discretionary + saved did not reconcile with the displayed surplus.
    // See the "Surplus allocation (H5)" block below.

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
    const withdrawals = { byAccount: {} as Record<string, number>, total: 0 };
    const entityWithdrawals = { byAccount: {} as Record<string, number>, total: 0 };
    let withdrawalTax = 0;

    // Cash drawdown reporting is computed AFTER the convergence loop so it
    // accounts for taxes (which are paid from checking later in this phase).
    // See the post-convergence block below.

    // 12b. `householdWithdrawBalances` was hoisted above phase 5b so the
    // bracket-filler sizer can see it. See the construction at the top of
    // the year-loop body.

    // Iterative tax + supplemental convergence (audit F5) — now jointly
    // converging the fill_up_bracket Roth conversion target. Each iteration:
    //   (a) re-sizes every bracket-filler conversion given the current
    //       supplemental withdrawal snapshot;
    //   (b) re-plans the supplemental withdrawal against `reservedBalances`
    //       (a copy of householdWithdrawBalances with the conversion's source
    //       pool reserved so we don't double-budget the same IRA);
    //   (c) reruns the tax pipeline with BOTH the bracket-filler taxable AND
    //       the supplemental recognized income layered onto baselineTaxDetail.
    // Converges in 1-3 iterations on typical deficit years; MAX_ITER caps.
    const baselineTaxDetail = { ...taxDetail, bySource: { ...taxDetail.bySource } };
    const MAX_ITER = 5;
    const TOLERANCE = 1;

    // A fill-bracket conversion is "on target" when its post-conversion base
    // hits the ceiling — OR when it has already converted its entire fundable
    // source pool yet still sits at/under the ceiling. The latter is the
    // depleted-IRA case: the bracket simply can't be filled further this year,
    // so it's converged (not an unsolved residual). Without this, the loop
    // would size a target larger than the source pool, tax the household on a
    // conversion that never happens, and pin the bracket report at "$1 left".
    const fillBracketOnTarget = (cid: string, baseAtTarget: number): boolean => {
      const ceiling = fillBracketCeilingsById[cid];
      if (Math.abs(baseAtTarget - ceiling) <= TOLERANCE) return true;
      const cap = fillBracketSourceCapById[cid] ?? Infinity;
      const poolExhausted = (pendingFillBracketTargets[cid] ?? 0) >= cap - TOLERANCE;
      return poolExhausted && baseAtTarget <= ceiling + TOLERANCE;
    };

    let cumulativeShortfall = 0;
    let supplementalPlan: ReturnType<typeof planSupplementalWithdrawal> = {
      byAccount: {},
      total: 0,
      draws: [],
      recognizedIncome: { ordinaryIncome: 0, capitalGains: 0, earlyWithdrawalPenalty: 0 },
    };
    let taxOutForIter = taxOut;
    // Tracks the EXACT input that produced the latest taxOutForIter, so the
    // equity tax counterfactual (below) re-runs from the same baseline.
    let finalTaxInput: YearTaxInput = baseTaxInput;
    // R4: fold Roth/HSA education draws' non-taxable slice into the base result so a
    // surplus year (no supplemental draw → the convergence loops below never rebuild
    // the tax input) still reports it. taxFreeRetirementIncome only affects display
    // totals (nonTaxableIncome / grossTotalIncome), never taxes / AGI / MAGI — so the
    // pre-supplemental `taxes` and Medicare MAGI already computed above are unchanged.
    if (educationTaxFreeIncome > 0) {
      finalTaxInput = { ...baseTaxInput, taxFreeRetirementIncome: educationTaxFreeIncome };
      taxOutForIter = computeTaxForYear(finalTaxInput);
    }
    let convergenceWarning: TrustWarning | null = null;
    // Converged draw target for the legacy no-checking branch (base deficit +
    // recomputed tax + penalty). Sized in phase 12 below; the application
    // block posts any (target − funded) remainder as an overdraft (M14).
    let legacyShortfallTarget = 0;

    // If bracket-fillers exist, recompute `taxOutForIter` with the seeded
    // fill-bracket taxable layered in. This runs whether or not we enter the
    // hasChecking loop — the no-checking path uses `taxOutForIter` directly
    // as the final result, and the loop path needs it for the initial
    // `checkingAfterTax` calc (else the surplus-no-draws short circuit fires
    // before `taxOutForIter` reflects the conversion's tax bill).
    if (fillBracketProbe) {
      const seededTotal = Object.values(pendingFillBracketTargets)
        .reduce((s, v) => s + v, 0);
      if (seededTotal > 0) {
        const seededTaxDetail: typeof taxDetail = {
          ...baselineTaxDetail,
          ordinaryIncome: baselineTaxDetail.ordinaryIncome + seededTotal,
          bySource: { ...baselineTaxDetail.bySource },
        };
        const seededTaxInput: YearTaxInput = {
          taxDetail: seededTaxDetail,
          socialSecurityGross: income.socialSecurity,
          totalIncome: income.total,
          taxableIncome: taxableIncome + seededTotal,
          filingStatus,
          year,
          planSettings: planSettingsForYear,
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
          retirementBreakdown,
          contrib529,
          primaryAge: ages.client,
          spouseAge: ages.spouse,
          isoSpread: equityIsoSpread,
        };
        taxOutForIter = computeTaxForYear(seededTaxInput);
        finalTaxInput = seededTaxInput;
      }
    }

    if (hasChecking) {
      let checkingAfterTax = preSupplementalChecking - taxOutForIter.taxes;

      const initialTaxes = taxOutForIter.taxes;
      for (let iter = 0; iter < MAX_ITER; iter++) {
        // Joint convergence test: bracket fillers must also be on-target.
        let bracketConverged = true;
        if (fillBracketProbe) {
          for (const cid of Object.keys(fillBracketCeilingsById)) {
            const baseAtCurrent = fillBracketProbe(
              pendingFillBracketTargets[cid] ?? 0,
              supplementalPlan.recognizedIncome.ordinaryIncome,
              supplementalPlan.recognizedIncome.capitalGains,
            );
            if (!fillBracketOnTarget(cid, baseAtCurrent)) {
              bracketConverged = false;
              break;
            }
          }
        }
        if (Math.abs(checkingAfterTax) <= TOLERANCE && bracketConverged) break;

        // Initial-surplus / final-surplus case with no draws-to-undo: nothing
        // to do unless brackets still need adjustment.
        if (checkingAfterTax > 0 && cumulativeShortfall === 0 && bracketConverged) break;

        // Step (b): re-plan supplemental withdrawal using the CURRENT
        // bracket-filler target as a balance reservation. Done first so step (a)
        // can size the conversion against the freshly-updated supplemental — if
        // we sized the conversion first using stale supp, the next iteration
        // would zero it out (when new supp pushes base above ceiling) and slow
        // convergence. Source-list order matches applyRothConversions.
        const reservedBalances: Record<string, number> = { ...householdWithdrawBalances };
        if (fillBracketProbe) {
          for (const [cid, target] of Object.entries(pendingFillBracketTargets)) {
            const conv = bracketFillerById.get(cid);
            if (!conv) continue;
            let remaining = target;
            for (const sid of conv.sourceAccountIds) {
              if (remaining <= 0) break;
              const avail = reservedBalances[sid] ?? 0;
              const reserve = Math.min(remaining, avail);
              reservedBalances[sid] = Math.max(0, avail - reserve);
              remaining -= reserve;
            }
          }
        }

        // Newton-style step on the supplemental side (existing logic).
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
          householdBalances: reservedBalances,
          basisMap,
          freshBasisMap,
          rothValueMap,
          accounts: workingAccounts,
          ages: { client: ages.client, spouse: ages.spouse ?? null },
          isSpouseAccount,
          year,
        });

        // Step (a): NOW size each fill_up_bracket conversion against the
        // freshly-planned supplemental snapshot. Final target + final supp are
        // jointly consistent inside this iter — step (c) below sees both.
        if (fillBracketProbe) {
          for (const cid of Object.keys(fillBracketCeilingsById)) {
            pendingFillBracketTargets[cid] = Math.min(
              sizeFillBracketConversion(
                fillBracketCeilingsById[cid],
                fillBracketProbe,
                supplementalPlan.recognizedIncome.ordinaryIncome,
                supplementalPlan.recognizedIncome.capitalGains,
              ),
              fillBracketSourceCapById[cid] ?? Infinity,
            );
          }
        }

        const totalFillBracketTaxable = Object.values(pendingFillBracketTargets)
          .reduce((s, v) => s + v, 0);

        // Step (c): tax calc with BOTH fill-bracket taxable AND supplemental income.
        const taxDetailWithBoth: typeof taxDetail = {
          ...baselineTaxDetail,
          ordinaryIncome:
            baselineTaxDetail.ordinaryIncome
            + totalFillBracketTaxable
            + supplementalPlan.recognizedIncome.ordinaryIncome,
          capitalGains:
            baselineTaxDetail.capitalGains
            + supplementalPlan.recognizedIncome.capitalGains,
          bySource: { ...baselineTaxDetail.bySource },
        };

        // Fold this iteration's supplemental IRA/401(k) draws into the per-source
        // retirement breakdown so state retirement-income exclusions (PA, IL, MS,
        // and every capped state) apply to spending-driven distributions — not
        // just RMDs. The base `retirementBreakdown` captured only RMDs + scheduled
        // draws; the supplemental draw is recognized as ordinary income above but
        // must also enter the state exclusion bucket or the state engine taxes a
        // distribution the state exempts. Re-derived each iteration because
        // `supplementalPlan` is re-planned (not accumulated) from the current
        // shortfall. Mirrors the base classification (subType → ira/k401) above.
        const supplementalRetirementBreakdown = { ...retirementBreakdown };
        for (const draw of supplementalPlan.draws) {
          if (draw.ordinaryIncome <= 0) continue;
          const sub = accountById.get(draw.accountId)?.subType ?? "";
          if (sub === "traditional_ira") supplementalRetirementBreakdown.ira += draw.ordinaryIncome;
          else if (sub === "401k" || sub === "403b") supplementalRetirementBreakdown.k401 += draw.ordinaryIncome;
        }

        const supplementalTaxFree = educationTaxFreeIncome + sumTaxFreeSlice(supplementalPlan.draws);

        const supplementalTaxInput: YearTaxInput = {
          taxDetail: taxDetailWithBoth,
          socialSecurityGross: income.socialSecurity,
          totalIncome: income.total,
          taxableIncome:
            taxableIncome
            + totalFillBracketTaxable
            + supplementalPlan.recognizedIncome.ordinaryIncome
            + supplementalPlan.recognizedIncome.capitalGains,
          filingStatus,
          year,
          planSettings: planSettingsForYear,
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
          retirementBreakdown: supplementalRetirementBreakdown,
          contrib529,
          primaryAge: ages.client,
          spouseAge: ages.spouse,
          isoSpread: equityIsoSpread,
          taxFreeRetirementIncome: supplementalTaxFree,
        };
        taxOutForIter = computeTaxForYear(supplementalTaxInput);
        finalTaxInput = supplementalTaxInput;

        const taxAndPenalty =
          taxOutForIter.taxes + supplementalPlan.recognizedIncome.earlyWithdrawalPenalty;
        checkingAfterTax = preSupplementalChecking + supplementalPlan.total - taxAndPenalty;

        if (iter === MAX_ITER - 1) {
          const bracketResiduals: Record<string, number> = {};
          if (fillBracketProbe) {
            for (const [cid, ceiling] of Object.entries(fillBracketCeilingsById)) {
              const baseAtCurrent = fillBracketProbe(
                pendingFillBracketTargets[cid] ?? 0,
                supplementalPlan.recognizedIncome.ordinaryIncome,
                supplementalPlan.recognizedIncome.capitalGains,
              );
              // A conversion that exhausted its source pool below the ceiling is
              // on-target, not an unconverged residual — don't warn for it.
              bracketResiduals[cid] = fillBracketOnTarget(cid, baseAtCurrent)
                ? 0
                : baseAtCurrent - ceiling;
            }
          }
          const anyBracketResidual = Object.values(bracketResiduals).some(
            (r) => Math.abs(r) > TOLERANCE,
          );
          if (Math.abs(checkingAfterTax) > TOLERANCE || anyBracketResidual) {
            convergenceWarning = {
              code: "engine_iteration_limit",
              year,
              residual: checkingAfterTax,
              iterations: MAX_ITER,
              ...(Object.keys(bracketResiduals).length > 0
                ? { bracketResiduals }
                : {}),
            };
          }
        }
      }
    } else {
      // Legacy path: no default checking → a deficit triggers a direct draw.
      // H7/M13 (audit 2026-07-01): the draw recognizes income via
      // categorizeDraw, recomputes the year's tax, and charges the pre-59½
      // penalty — mirroring the hasChecking convergence loop above. The
      // deficit also folds in the fill-bracket conversion tax delta (seeded
      // `taxOutForIter` vs the base `taxes` already inside
      // householdNonSavingsOutflows) so a conversion's tax bill is funded even
      // when base flows are balanced. Purchase equity is folded into outflows
      // so a purchase-driven deficit still triggers a withdrawal. Runs here in
      // phase 12 (not the application block below) so `finalTaxResult` /
      // `finalTaxes` capture the recomputed tax; the balance mutations happen
      // in the application block, mirroring the hasChecking split.
      const purchaseEquity = purchaseBreakdown.reduce((sum, p) => sum + p.equity, 0);
      const seededTaxes = taxOutForIter.taxes;
      const legacyNetFlow =
        householdInflows - householdNonSavingsOutflows - savings.total - purchaseEquity
        - (seededTaxes - taxes);
      if (legacyNetFlow < 0) {
        const baseDeficit = -legacyNetFlow;
        let target = baseDeficit;
        for (let iter = 0; iter < MAX_ITER; iter++) {
          // planSupplementalWithdrawal enforces the pre-65 HSA lock per owner
          // age internally, so no strategy pre-filter is needed here.
          supplementalPlan = planSupplementalWithdrawal({
            shortfall: target,
            strategy: effectiveWithdrawalStrategy,
            householdBalances: householdWithdrawBalances,
            basisMap,
            freshBasisMap,
            rothValueMap,
            accounts: workingAccounts,
            ages: { client: ages.client, spouse: ages.spouse ?? null },
            isSpouseAccount,
            year,
          });

          // Recompute the year's tax with the draw's recognized income layered
          // on top of the (fill-bracket-seeded) baseline — same input shape as
          // the hasChecking loop's step (c), minus bracket re-sizing (the
          // seeded fill-bracket targets stay fixed on this path).
          const totalFillBracketTaxable = Object.values(pendingFillBracketTargets)
            .reduce((s, v) => s + v, 0);
          const taxDetailWithDraws: typeof taxDetail = {
            ...baselineTaxDetail,
            ordinaryIncome:
              baselineTaxDetail.ordinaryIncome
              + totalFillBracketTaxable
              + supplementalPlan.recognizedIncome.ordinaryIncome,
            capitalGains:
              baselineTaxDetail.capitalGains
              + supplementalPlan.recognizedIncome.capitalGains,
            bySource: { ...baselineTaxDetail.bySource },
          };

          // Fold supplemental IRA/401(k) draws into the per-source retirement
          // breakdown so state retirement-income exclusions (PA, IL, MS, and
          // capped states) apply to spending-driven distributions — mirrors
          // the hasChecking loop.
          const supplementalRetirementBreakdown = { ...retirementBreakdown };
          for (const draw of supplementalPlan.draws) {
            if (draw.ordinaryIncome <= 0) continue;
            const sub = accountById.get(draw.accountId)?.subType ?? "";
            if (sub === "traditional_ira") supplementalRetirementBreakdown.ira += draw.ordinaryIncome;
            else if (sub === "401k" || sub === "403b") supplementalRetirementBreakdown.k401 += draw.ordinaryIncome;
          }

          const legacyTaxInput: YearTaxInput = {
            taxDetail: taxDetailWithDraws,
            socialSecurityGross: income.socialSecurity,
            totalIncome: income.total,
            taxableIncome:
              taxableIncome
              + totalFillBracketTaxable
              + supplementalPlan.recognizedIncome.ordinaryIncome
              + supplementalPlan.recognizedIncome.capitalGains,
            filingStatus,
            year,
            planSettings: planSettingsForYear,
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
            retirementBreakdown: supplementalRetirementBreakdown,
            contrib529,
            primaryAge: ages.client,
            spouseAge: ages.spouse,
            isoSpread: equityIsoSpread,
            taxFreeRetirementIncome: educationTaxFreeIncome + sumTaxFreeSlice(supplementalPlan.draws),
          };
          taxOutForIter = computeTaxForYear(legacyTaxInput);
          finalTaxInput = legacyTaxInput;

          const desiredTotal =
            baseDeficit
            + (taxOutForIter.taxes - seededTaxes)
            + supplementalPlan.recognizedIncome.earlyWithdrawalPenalty;

          // Pool exhausted: draws can't grow further and the recomputed tax
          // already reflects the actual draws. The remainder becomes the
          // overdraft posted in the application block below.
          if (supplementalPlan.total < target - TOLERANCE) {
            target = desiredTotal;
            break;
          }

          const residual = desiredTotal - target;
          if (Math.abs(residual) <= TOLERANCE) break;

          // Newton step, same shape as the hasChecking loop: gross up by the
          // draw's effective tax+penalty rate to accelerate convergence.
          const legacyCost = desiredTotal - baseDeficit;
          const effectiveRate =
            supplementalPlan.total > 0 ? legacyCost / supplementalPlan.total : 0;
          target += residual / Math.max(0.01, 1 - effectiveRate);
        }
        legacyShortfallTarget = target;
      }
    }

    // After phase 12 converges, actually apply the bracket-filler conversions
    // with the converged targets. This mutates accountBalances / basisMap /
    // rothValueMap / accountLedgers and updates rothConversionResult so the
    // year output sees the conversions. The tax bill in `taxOutForIter`
    // already reflects these targets — we don't re-run the tax calc.
    if (
      fillBracketProbe &&
      data.rothConversions &&
      Object.keys(pendingFillBracketTargets).length > 0
    ) {
      const fillerConversions = data.rothConversions.filter(
        (c) =>
          c.enabled !== false &&
          c.conversionType === "fill_up_bracket" &&
          pendingFillBracketTargets[c.id] != null,
      );
      const fillerResult = applyRothConversions({
        conversions: fillerConversions,
        accounts: workingAccounts,
        accountBalances,
        basisMap,
        rothValueMap,
        accountLedgers,
        year,
        ownerAges: { client: ages.client, spouse: ages.spouse },
        spouseFamilyMemberId: spouseFmId,
        ordinaryBrackets: convBrackets,
        targetTaxableOverride: pendingFillBracketTargets,
      });

      rothConversionResult.taxableOrdinaryIncome += fillerResult.taxableOrdinaryIncome;
      for (const [cid, info] of Object.entries(fillerResult.byConversion)) {
        rothConversionResult.byConversion[cid] = info;
        if (info.taxable > 0) {
          taxDetail.bySource[`roth_conversion:${cid}`] = {
            type: "ordinary_income",
            amount: info.taxable,
          };
        }
      }

      if (fillerResult.taxableOrdinaryIncome > 0) {
        taxableIncome += fillerResult.taxableOrdinaryIncome;
        taxDetail.ordinaryIncome += fillerResult.taxableOrdinaryIncome;
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
    // income gets a `withdrawal:<acctId>` bySource entry (plus a
    // `withdrawal_tax_free:<acctId>` entry for the untaxed retirement slice) so
    // taxDetail.bySource sums to the bucket totals. R2: accumulates per account
    // so a second draw on the same account doesn't overwrite the first.
    Object.assign(
      finalTaxDetail.bySource,
      supplementalDrawSources(supplementalPlan.draws, taxFreeRetirementSlice),
    );

    // === Equity tax impact (counterfactual) =================================
    // "Additional tax because of stock options" = tax(actual) − tax(equity
    // income removed), computed from the SAME input that produced
    // finalTaxResult. Computed here, BEFORE the supplemental early-withdrawal
    // penalty is layered onto finalTaxResult.flow below, so neither side carries
    // that (non-equity) penalty. The cap-gains-tax delta automatically includes
    // the bracket-push on the client's other gains.
    let equityTaxImpact: EquityTaxImpact | undefined;
    if (
      equityOrdinaryIncome !== 0 ||
      equityCapitalGains !== 0 ||
      equityStCapitalGains !== 0 ||
      equityIsoSpread !== 0
    ) {
      const counterfactualInput: YearTaxInput = {
        ...finalTaxInput,
        taxDetail: {
          ...finalTaxInput.taxDetail,
          earnedIncome: finalTaxInput.taxDetail.earnedIncome - equityOrdinaryIncome,
          capitalGains: finalTaxInput.taxDetail.capitalGains - equityCapitalGains,
          stCapitalGains: finalTaxInput.taxDetail.stCapitalGains - equityStCapitalGains,
          bySource: { ...finalTaxInput.taxDetail.bySource },
        },
        taxableIncome:
          finalTaxInput.taxableIncome
          - equityOrdinaryIncome
          - equityCapitalGains
          - equityStCapitalGains,
        isoSpread: 0,
      };
      const counterfactual = computeTaxForYear(counterfactualInput);
      equityTaxImpact = diffEquityTaxImpact(
        finalTaxResult.flow,
        counterfactual.taxResult.flow,
        {
          ordinaryIncome: equityOrdinaryIncome,
          capitalGains: equityCapitalGains + equityStCapitalGains,
          isoSpread: equityIsoSpread,
        },
      );
    }

    // Update magiHistory with the FINAL post-supplemental MAGI so next year's
    // year-2 lookback resolver sees the converged AGI (including any
    // supplemental withdrawal recognized income). The actual Medicare cost
    // for THIS year was already computed earlier (before phase 6) using
    // pre-supplemental MAGI — see the Medicare block above phase 6 for the
    // rationale on placement.
    const magiThisYear =
      (finalTaxResult?.flow.adjustedGrossIncome ?? 0) +
      (finalTaxDetail?.taxExemptInterest ?? 0);
    magiHistory.set(year, magiThisYear);

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

        // Basis reduction for taxable/cash accounts uses the actual basisReturn
        // from categorizeDraw (fresh-basis-first ordering per spec 2026-05-11),
        // not pure pro-rata. The basis delta this withdrawal entry carries MUST
        // equal the exact change the gate below applies to basisMap (clamped at
        // 0), so the Task-9 reconciliation (basisResidual ≈ 0) holds. Compute it
        // up-front from the pre-mutation basis so the push can carry it: for
        // taxable/cash sources the entry sheds -min(basisReturn, basisBefore);
        // retirement sources (and depleted preBalance ≤ 0) touch no basis → 0.
        const drawAccount = accountById.get(draw.accountId);
        const gatesBasis =
          (drawAccount?.category === "taxable" || drawAccount?.category === "cash") && preBalance > 0;
        const basisBefore = basisMap[draw.accountId] ?? 0;
        const entryBasisDelta = gatesBasis
          ? -Math.min(draw.basisReturn, basisBefore)
          : 0;

        if (accountLedgers[draw.accountId]) {
          accountLedgers[draw.accountId].distributions += draw.amount;
          accountLedgers[draw.accountId].endingValue -= draw.amount;
          accountLedgers[draw.accountId].entries.push({
            category: "withdrawal",
            label: "Withdrawal to cover household shortfall",
            amount: -draw.amount,
            counterpartyId: checkingId, // proceeds refill household checking
            basis: entryBasisDelta, // == basisMap delta applied by the gate below
          });
        }

        if (gatesBasis) {
          basisMap[draw.accountId] = Math.max(
            0,
            basisBefore - draw.basisReturn,
          );
          const freshBefore = freshBasisMap[draw.accountId] ?? 0;
          const consumed = Math.min(freshBefore, draw.amount);
          freshBasisMap[draw.accountId] = Math.max(0, freshBefore - consumed);

          if (accountLedgers[draw.accountId]) {
            const existing = accountLedgers[draw.accountId].withdrawalDetail ?? { realizedLtcg: 0, basisReturn: 0 };
            accountLedgers[draw.accountId].withdrawalDetail = {
              realizedLtcg: existing.realizedLtcg + draw.capitalGains,
              basisReturn: existing.basisReturn + draw.basisReturn,
            };
          }
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
            basis: supplementalPlan.total, // cash inflow: basis == amount (1:1)
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
            basis: -taxAndPenalty, // cash outflow: basis == amount (signed)
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
      // Legacy path (no default checking): apply the draws planned by the
      // phase-12 legacy convergence above. Same balance/basis/Roth
      // bookkeeping as the hasChecking application block, minus the checking
      // refill leg (proceeds pay expenses directly in the legacy model).
      {
        for (const draw of supplementalPlan.draws) {
          if (draw.amount <= 0) continue;
          const preBalance = accountBalances[draw.accountId] ?? 0;
          accountBalances[draw.accountId] -= draw.amount;
          withdrawals.byAccount[draw.accountId] =
            (withdrawals.byAccount[draw.accountId] ?? 0) + draw.amount;
          withdrawals.total += draw.amount;

          const drawAccount = accountById.get(draw.accountId);
          const gatesBasis =
            (drawAccount?.category === "taxable" || drawAccount?.category === "cash") && preBalance > 0;
          const basisBefore = basisMap[draw.accountId] ?? 0;
          const entryBasisDelta = gatesBasis
            ? -Math.min(draw.basisReturn, basisBefore)
            : 0;

          if (accountLedgers[draw.accountId]) {
            accountLedgers[draw.accountId].distributions += draw.amount;
            accountLedgers[draw.accountId].endingValue -= draw.amount;
            accountLedgers[draw.accountId].entries.push({
              category: "withdrawal",
              label: "Withdrawal to cover shortfall",
              amount: -draw.amount,
              basis: entryBasisDelta, // == basisMap delta applied by the gate below
            });
          }

          if (gatesBasis) {
            basisMap[draw.accountId] = Math.max(0, basisBefore - draw.basisReturn);
            const freshBefore = freshBasisMap[draw.accountId] ?? 0;
            const consumed = Math.min(freshBefore, draw.amount);
            freshBasisMap[draw.accountId] = Math.max(0, freshBefore - consumed);

            if (accountLedgers[draw.accountId]) {
              const existing = accountLedgers[draw.accountId].withdrawalDetail ?? { realizedLtcg: 0, basisReturn: 0 };
              accountLedgers[draw.accountId].withdrawalDetail = {
                realizedLtcg: existing.realizedLtcg + draw.capitalGains,
                basisReturn: existing.basisReturn + draw.basisReturn,
              };
            }
          }

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

        // M14: any unfunded remainder overdraws the last-drawn (or first
        // eligible strategy) account, mirroring a hasChecking plan whose
        // checking goes negative when broke. Without this, a depleted
        // no-checking plan silently absorbs the deficit, its liquid total
        // never dips below zero, and Monte-Carlo can never classify failure.
        // No income is recognized on the overdraft — it's an unfunded
        // shortfall, not a real distribution.
        const unfunded = legacyShortfallTarget - supplementalPlan.total;
        if (unfunded > TOLERANCE) {
          const overdraftId =
            supplementalPlan.draws.length > 0
              ? supplementalPlan.draws[supplementalPlan.draws.length - 1].accountId
              : effectiveWithdrawalStrategy
                  .filter((s) => year >= s.startYear && year <= s.endYear)
                  .sort((a, b) => a.priorityOrder - b.priorityOrder)
                  .find((s) => accountBalances[s.accountId] !== undefined)?.accountId;
          if (overdraftId) {
            accountBalances[overdraftId] -= unfunded;
            withdrawals.byAccount[overdraftId] =
              (withdrawals.byAccount[overdraftId] ?? 0) + unfunded;
            withdrawals.total += unfunded;
            if (accountLedgers[overdraftId]) {
              accountLedgers[overdraftId].distributions += unfunded;
              accountLedgers[overdraftId].endingValue -= unfunded;
              accountLedgers[overdraftId].entries.push({
                category: "withdrawal",
                label: "Unfunded shortfall (accounts depleted)",
                amount: -unfunded,
                basis: 0,
              });
            }
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

        // Pro-rata basis the source sheds this liquidation — must match the
        // basisMap mutation below so reconciliation holds. Only taxable sources
        // with positive pre-balance touch basisMap; everything else sheds 0.
        // Computed up-front from the pre-mutation basis so the source entry can
        // carry it; the mutation below clamps at 0 but acctBasis*(1-fraction) is
        // already ≥ 0, so the applied delta is exactly -acctBasis*fraction.
        const acct = liquidatableAcctById.get(acctId);
        const liqTaxable = acct?.category === "taxable" && preBalance > 0;
        const liqBasisBefore = basisMap[acctId] ?? preBalance;
        const liqFraction = preBalance > 0 ? Math.min(1, amount / preBalance) : 0;
        const sourceBasisDelta = liqTaxable ? -liqBasisBefore * liqFraction : 0;

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
            basis: sourceBasisDelta, // == basisMap delta applied below
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
            basis: amount, // cash inflow: basis == amount (1:1)
          });
        }

        // Cap-gains realization wiring for taxable liquidations. Compute the
        // pro-rata gain against the pre-liquidation balance, reduce basis by
        // the same fraction, and stash the gain for NEXT year's trust-tax pass
        // (deferred — trust marginal rate isn't available at gap-fill time).
        // Routing (grantor → household 1040 vs non-grantor → trust 1041)
        // happens at drain time in next year's loop iteration so a grantor
        // flip in the intervening year is honored.
        if (liqTaxable) {
          const acctBasis = liqBasisBefore;
          const fraction = liqFraction;
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

    // 13. Portfolio snapshot is taken AFTER the surplus allocation (phase 14
    // below) so it reflects the discretionary spend leaving checking and any
    // surplus transferred to a destination account. See the
    // `computePortfolioSnapshot` call after Net Cash Flow is finalized.

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
    //
    // Entity-owned sale proceeds belong to the OWNING ENTITY, not the
    // household: applyAssetSales already routed that cash to the entity's
    // checking (asset-transactions.ts proceeds routing) and the entity
    // cash-flow rollup excludes it (isSaleProceeds). Mirror that predicate here
    // so a trust/business sale's proceeds aren't double-counted — once in the
    // entity's cash balance and again as household "Other income". Resolve
    // ownership against the invariant `accountById` (sold accounts are gone from
    // workingAccounts by now); a missing account (synthetic technique source)
    // falls back to household, matching the router's default-checking fallback.
    // `controllingEntity` is the SAME 100%-single-entity predicate the router
    // uses, so the two stay in sync — split-owned sales (controllingEntity null)
    // surface as household income, matching the router routing 100% of their
    // proceeds to the household default checking.
    const householdSales = saleResult.breakdown.filter((item) => {
      const sold = accountById.get(item.accountId);
      return !sold || controllingEntity(sold) == null;
    });
    const totalNetProceeds = householdSales.reduce((s, x) => s + x.netProceeds, 0);
    const totalPurchaseEquity = purchaseBreakdown.reduce((s, x) => s + x.equity, 0);
    const absorption = Math.min(totalNetProceeds, totalPurchaseEquity);

    for (const item of householdSales) {
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

    // C2: fold the gap-fill (pre-59½ supplemental) early-withdrawal penalty into
    // the converged tax result so the cash-flow "Taxes" line (expenses.taxes) and
    // the income-tax report "Total Tax" (taxResult.flow.totalTax) read the same
    // number. `finalTaxes`/`taxAndPenalty` above captured the pre-fold totalTax,
    // so the actual checking debit is unaffected.
    // Applies on BOTH funding paths: the hasChecking convergence loop and the
    // legacy no-checking branch (H7) populate `supplementalPlan` the same way.
    if (supplementalEarlyPenalty > 0) {
      finalTaxResult.flow.earlyWithdrawalPenalty += supplementalEarlyPenalty;
      finalTaxResult.flow.totalTax += supplementalEarlyPenalty;
      finalTaxResult.flow.totalFederalTax += supplementalEarlyPenalty;
    }
    const totalTaxes = finalTaxResult.flow.totalTax;
    // Property tax only counts toward the household realEstate bucket for the
    // household-share synthetic rows. Entity-owned shares are tagged with
    // ownerEntityId and route to the entity's checking via resolveCashAccount.
    const householdSyntheticExpenseTotal = syntheticExpenses
      .filter((s) => s.ownerEntityId == null)
      .reduce((sum, s) => sum + s.annualAmount, 0);
    const expenses = {
      living: expenseBreakdown.living - hypoFromExpenseReduction,
      liabilities: liabResult.totalPayment,
      other: expenseBreakdown.other + techniqueExpenses + householdCashGiftsTotal,
      insurance: expenseBreakdown.insurance,
      realEstate: householdSyntheticExpenseTotal,
      taxes: totalTaxes,
      cashGifts: householdCashGiftsTotal,
      discretionary: expenseBreakdown.discretionary,
      total:
        (expenseBreakdown.living - hypoFromExpenseReduction) +
        expenseBreakdown.other +
        expenseBreakdown.insurance +
        expenseBreakdown.discretionary +
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

    // Medicare post-processing on the expenses literal.
    //   (a) Zero out any pre-Medicare expense flagged endsAtMedicareEligibilityOwner
    //       whose owner is enrolled this year. Subtract from total + per-category.
    //   (b) Inject the household's modeled Medicare total as a single bySource row
    //       and add it to insurance + total.
    if (medicarePreemptedExpenseIds.size > 0) {
      for (const id of medicarePreemptedExpenseIds) {
        const amt = expenses.bySource[id];
        if (!amt) continue;
        delete expenses.bySource[id];
        expenses.total -= amt;
        const src = data.expenses.find((x) => x.id === id);
        if (src) {
          if (src.type === "insurance") expenses.insurance -= amt;
          else if (src.type === "living") expenses.living -= amt;
          else expenses.other -= amt;
        }
      }
    }
    if (medicareTotalAnnualCost > 0) {
      expenses.bySource["medicarePremiums"] = medicareTotalAnnualCost;
      expenses.total += medicareTotalAnnualCost;
      expenses.insurance += medicareTotalAnnualCost;
    }

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
    // Grantor-trust gross folded into display income: total minus business
    // gross (business is shown via businessDistributions instead, avoiding a
    // double-count). Also the gross side of the F2 surplus correction below.
    const grantorGrossFolded = grantorIncome.total - grantorIncome.business;
    const displayIncome = {
      salaries: income.salaries + grantorIncome.salaries,
      socialSecurity: income.socialSecurity + grantorIncome.socialSecurity,
      business: income.business + businessDistributions,
      trust: income.trust + grantorIncome.trust,
      deferred: income.deferred + grantorIncome.deferred,
      capitalGains: income.capitalGains + grantorIncome.capitalGains,
      other: income.other + grantorIncome.other,
      total: income.total + grantorGrossFolded + businessDistributions,
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
      if (!effectiveIsGrantor(inc.ownerEntityId, year)) continue; // non-grantor: never in bySource here
      delete displayIncome.bySource[inc.id];
    }
    // householdNoteCashIn and householdEquityCashIn folded in so notes-
    // receivable principal+interest and equity-sale net cash (both routed to
    // checking via creditCash, not into displayIncome.total) show up in both
    // Total Income and Net Cash Flow on the cashflow report. Equity proceeds
    // also carry a per-plan income.bySource key for the Other Inflows drill-
    // down; the fold here is what counts them in the Total Income scalar.
    const totalIncome =
      displayIncome.total + householdRmdIncome + householdNoteCashIn
      + householdEquityCashIn + householdTrustCashIn; // householdTrustCashIn: audit F8

    // ── 14. Surplus allocation (H5) ──
    // Size the discretionary/saved split from the resolved Net Cash Flow, taken
    // BEFORE any discretionary spend (`expenses.discretionary` is still 0 here).
    // That pre-discretionary surplus is exactly what would otherwise silently
    // accumulate in household checking, after every explicit flow has fired:
    // income incl. notes-receivable cash-in, technique sale proceeds, and
    // business distributions; expenses incl. the final converged tax, technique
    // purchase equity, synthetic property tax, savings, and gifts. Deficit years
    // (<= 0) are a no-op — phase 12's gap-fill already refilled checking.
    if (hasChecking) {
      const checkingId = defaultChecking!.id;
      const checkingLedger = accountLedgers[checkingId];
      // Debit checking and record the outflow. Runs after this year's
      // cash-delta flush + tax debit, so it writes balances/ledger directly
      // (mirrors the post-convergence tax-debit pattern above) rather than
      // routing through the already-flushed `creditCash`.
      const debitChecking = (amount: number, entry: AccountLedgerEntry): void => {
        accountBalances[checkingId] = (accountBalances[checkingId] ?? 0) - amount;
        if (checkingLedger) {
          checkingLedger.endingValue -= amount;
          checkingLedger.distributions += amount;
          checkingLedger.entries.push(entry);
        }
      };
      // F2: the surplus base must count grantor-trust CASH RECEIVED, not gross
      // income attributed. grantorGrossFolded is in totalIncome but its cash
      // routes to TRUST checking — reaching the household only via the grantor
      // distribution pass. Replace gross with cash received by subtracting the
      // retained (undistributed) portion. Negative when the trust distributes
      // principal in excess of income — correctly adding that cash.
      const grantorTrustSurplusCorrection =
        grantorGrossFolded - grantorTrustDistToHousehold;
      const surplusForSplit = Math.max(
        0,
        totalIncome
          - expenses.total
          - savings.total
          - hypoContribution
          - grantorTrustSurplusCorrection
      );
      if (surplusForSplit > 0) {
        const rawPct = data.planSettings.surplusSpendPct ?? 0;
        const spendPct = Math.min(1, Math.max(0, rawPct));
        const spendAmount = surplusForSplit * spendPct;
        const saveAmount = surplusForSplit - spendAmount;

        // Discretionary spend leaves the household entirely.
        if (spendAmount > 0) {
          debitChecking(spendAmount, {
            category: "discretionary",
            label: "Discretionary spend (surplus)",
            amount: -spendAmount,
            basis: -spendAmount, // cash outflow: basis == amount (signed)
          });
          expenses.discretionary = spendAmount;
          expenses.total += spendAmount;
        }

        // Saved remainder: transfer to the chosen destination, else book an
        // explicit retained-surplus marker so the cash isn't silently absorbed
        // into Portfolio Activity (it stays in checking either way).
        const saveDestId = data.planSettings.surplusSaveAccountId ?? null;
        const canTransfer =
          saveAmount > 0 &&
          saveDestId != null &&
          saveDestId !== checkingId &&
          // Quietly skip if the user picked an account that no longer exists.
          data.accounts.some((a) => a.id === saveDestId);
        if (canTransfer) {
          debitChecking(saveAmount, {
            category: "surplus_transfer",
            label: "Surplus transferred out",
            amount: -saveAmount,
            sourceId: saveDestId!,
            basis: -saveAmount, // cash outflow: basis == amount (signed)
          });
          accountBalances[saveDestId!] = (accountBalances[saveDestId!] ?? 0) + saveAmount;
          // H5: the saved surplus is after-tax cash, so it raises the
          // destination's cost basis 1:1 — otherwise a later sale re-recognizes
          // it as capital gain (basisMap persists across years and feeds the
          // withdrawal cap-gain gate at draw time). Only taxable destinations
          // track a basisMap-backed basis: the EoY stamp reads basisMap for
          // non-cash, cash stamps endingValue, and pre-tax carries no cost
          // basis. Gate the ledger entry's basis to match so I2 holds for the
          // destination in every case. Mirrors the hypo-savings path.
          const destCategory = accountById.get(saveDestId!)?.category;
          const destTaxable = destCategory === "taxable";
          if (destTaxable) {
            basisMap[saveDestId!] = (basisMap[saveDestId!] ?? 0) + saveAmount;
          }
          const destLedger = accountLedgers[saveDestId!];
          if (destLedger) {
            destLedger.endingValue += saveAmount;
            destLedger.contributions += saveAmount;
            destLedger.entries.push({
              category: "surplus_transfer",
              label: "Surplus transferred in",
              amount: saveAmount,
              sourceId: checkingId,
              // Taxable & cash carry basis == amount (after-tax / cash
              // convention); pre-tax got no basisMap bump, so its entry basis is
              // 0 to keep basisBoY + Σ entry.basis == basisEoY.
              basis: destTaxable || destCategory === "cash" ? saveAmount : 0,
            });
          }
        } else if (saveAmount > 0 && checkingLedger) {
          // Already reflected in the balance + the net cash contribution above;
          // flagged internal so it isn't double-counted in aggregate add/
          // distribution reconciliation (mirrors the entity gap-fill refill).
          checkingLedger.entries.push({
            category: "surplus_retained",
            label: "Surplus retained in cash",
            amount: saveAmount,
            isInternalTransfer: true,
            basis: saveAmount, // stays in cash: basis == amount
          });
        }
      }
    }

    const totalExpenses = expenses.total + savings.total + hypoContribution;
    const netCashFlow = totalIncome - totalExpenses;

    // 13 (deferred). Portfolio snapshot — taken here, after the surplus
    // allocation, so it reflects the discretionary spend and any surplus
    // transfer. Extracted to a helper so the death-event blocks below can
    // recompute it against post-death account state.
    // Note: `total` intentionally stays as the legacy IIP-only sum so existing
    // consumers (BoY portfolio lookup, etc.) keep working. The cashflow drill
    // computes its grand total locally from all the *Total fields.
    const portfolioAssets = computePortfolioSnapshot({
      workingAccounts,
      accountBalances,
      giftEvents: data.giftEvents,
      year,
      planStartYear: planSettings.planStartYear,
      entityMap,
      principalFmIds,
    });

    // Build technique breakdown for drill-down UI
    const hasTechniques = saleResult.breakdown.length > 0 || purchaseBreakdown.length > 0;
    const txnNameMap = new Map((data.assetTransactions ?? []).map((t) => [t.id, t.name]));

    // Snapshot end-of-year account balances for gift-year value lookups at death.
    yearEndAccountBalances.set(year, { ...accountBalances });

    // Roll the locked-share carry forward for this year so both the
    // hypothetical estate tax (below) and the real death-event call sites can
    // pass an accurate entityAccountSharesEoY snapshot. Must run before
    // computeHypotheticalEstateTax so year-N's hypothetical sees year-N's
    // locked shares (not year N-1's). Recomputed every year (not just death
    // years) because accrueLockedEntityShare needs the prior EoY present for
    // every split-owned account.
    for (const acct of workingAccounts) {
      const ledger = accountLedgers[acct.id];
      if (!ledger) continue;
      for (const o of acct.owners) {
        if (o.kind !== "entity") continue;
        if (o.percent >= 1) continue; // 100%-entity needs no carry — full ledger is the share
        const carried = lockedEntityShareCarry.get(o.entityId)?.get(acct.id);
        const acc = accrueLockedEntityShare({
          carriedBoY: carried,
          ledger: {
            beginningValue: ledger.beginningValue,
            growth: ledger.growth,
            endingValue: ledger.endingValue,
          },
          percent: o.percent,
        });
        if (!lockedEntityShareCarry.has(o.entityId)) {
          lockedEntityShareCarry.set(o.entityId, new Map());
        }
        lockedEntityShareCarry.get(o.entityId)!.set(acct.id, acc.lockedEoY);
      }
    }
    // F3: sweep carry entries for accounts no longer in the projection (BoY
    // sale/liquidation removed them from workingAccounts) so death-event and
    // hypothetical-estate math never read a drained account's phantom slice.
    // Live accounts are handled by the clamp above.
    const liveAccountIds = new Set(workingAccounts.map((a) => a.id));
    for (const byAccount of lockedEntityShareCarry.values()) {
      for (const acctId of [...byAccount.keys()]) {
        if (!liveAccountIds.has(acctId)) byAccount.delete(acctId);
      }
    }

    // 4d-2: hypothetical estate tax — anchored to the real projected first death.
    //
    // For years N ≤ F (the real first death, or before it): both spouses are
    // still assumed alive, so we run the "both die in year N" hypothetical
    // (both orderings) on the pre-real-death snapshot of year-N state. This is
    // the `computeHypotheticalEstateTax` else-branch below, byte-identical to
    // the legacy behavior.
    //
    // For years N strictly after F (once `realFirstDeath` is populated — this
    // block runs before the current year's death block, so it is null in year F
    // itself and only non-null from F+1 onward): we FREEZE the real first death
    // and model only the survivor dying at N. Re-running the first death here
    // would recompute it against the drained post-death state (assets already
    // passed to the survivor), producing a bogus $0 first-death estate; the
    // anchored path reuses the frozen year-F event instead.
    //
    // Attached to the ProjectionYear at push time so the required field is
    // always populated. "Married" for the (pre-F) hypothetical means "a spouse
    // exists to die second" — the same signal the real projection uses to
    // schedule the second death (see computeFinalDeathYear, which keys off
    // `client.spouseDob`). Deriving this from filingStatus would model only one
    // death for a spouse'd household that files single/separately, routing
    // everything to the surviving spouse under the marital deduction and
    // showing $0 to heirs.
    const hypotheticalIsMarried = client.spouseDob != null;
    const hypotheticalEstateTax = options?.skipHypotheticalEstateTax
      ? emptyHypotheticalEstateTax(year)
      : realFirstDeath != null
        ? computeAnchoredHypotheticalEstateTax({
            year,
            survivor: realFirstDeath.decedent === "client" ? "spouse" : "client",
            realFirstDeath,
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
            relocations: data.relocations,
            yearEndAccountBalances,
            annualExclusionsByYear,
            priorTaxableGifts: data.planSettings.priorTaxableGifts ?? { client: 0, spouse: 0 },
            entityAccountSharesEoY: lockedEntityShareCarry,
            familyAccountSharesEoY: lockedFamilyShareCarry,
          })
        : computeHypotheticalEstateTax({
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
            entityAccountSharesEoY: lockedEntityShareCarry,
            familyAccountSharesEoY: lockedFamilyShareCarry,
          });

    // Stamp end-of-year basis onto each ledger now that all sales, growth
    // realization, contributions, and Roth conversions have settled. Death-
    // event mutations to basisMap happen *after* this push and land on the
    // next year's BoY, which is the right semantics for the drill-down view.
    for (const acctId of Object.keys(accountLedgers)) {
      // Cash basis ≡ value (basisMap isn't moved by cash flows): stamp the
      // ending balance so the basis column is correct and the ledger reconciles.
      accountLedgers[acctId].basisEoY =
        accountById.get(acctId)?.category === "cash"
          ? accountLedgers[acctId].endingValue
          : (basisMap[acctId] ?? 0);
      accountLedgers[acctId].rothValueEoY = rothValueMap[acctId] ?? 0;
    }

    // Surface per-grantor-entity realized asset-sale cap gains so
    // computeEntityCashFlow + the tax ledger can render them in the grantor
    // trust's own section (with an offsetting pass-through). The gain itself is
    // already taxed on the household 1040 via taxDetail.capitalGains; this is the
    // display value. Independent of the grantor distribution pass — a pure
    // grantor trust with no distribution policy still realizes (and shows) gains.
    // Resolve ownership against the invariant accountById (sold accounts are gone
    // from workingAccounts by now) and use the entity's CURRENT-year grantor status.
    const grantorCapGainsByEntity = new Map<string, number>();
    for (const item of saleResult.breakdown) {
      if (item.capitalGain <= 0) continue;
      const sold = accountById.get(item.accountId);
      if (!sold) continue;
      const owners = ownersForYear(sold, data.giftEvents, year, planSettings.planStartYear);
      for (const owner of owners) {
        if (owner.kind !== "entity") continue;
        if (!effectiveIsGrantor(owner.entityId, year)) continue;
        grantorCapGainsByEntity.set(
          owner.entityId,
          (grantorCapGainsByEntity.get(owner.entityId) ?? 0) + item.capitalGain * owner.percent,
        );
      }
    }

    years.push({
      year,
      ages,
      syntheticAccounts: [...equityDestByPlan.values()]
        .map((destId) => {
          const acct = workingAccounts.find((a) => a.id === destId);
          return acct
            ? { id: acct.id, name: acct.name, category: acct.category, owners: acct.owners ?? [] }
            : null;
        })
        .filter((a): a is NonNullable<typeof a> => a !== null),
      income: displayIncome,
      ...(income.socialSecurityDetail ? { socialSecurityDetail: income.socialSecurityDetail } : {}),
      taxDetail: finalTaxDetail,
      equityTaxImpact,
      taxResult: finalTaxResult,
      ...(medicareYearData ? { medicare: medicareYearData } : {}),
      charityCarryforward,
      charitableOutflows: cltCharitableOutflowsTotal,
      ...(cltCharitableOutflowDetail.length > 0
        ? { charitableOutflowDetail: cltCharitableOutflowDetail }
        : {}),
      ...(yearTrustTerminations.length > 0
        ? { trustTerminations: yearTrustTerminations }
        : {}),
      ...(grantorCapGainsByEntity.size > 0 ? { grantorCapGainsByEntity } : {}),
      deductionBreakdown: deductionBreakdownResult,
      withdrawals,
      entityWithdrawals,
      expenses,
      ...(educationGoalYears.length > 0 ? { educationGoals: educationGoalYears } : {}),
      savings,
      ...(hypoContribution > 0
        ? {
            hypotheticalSavings: {
              contribution: hypoContribution,
              fromCashFlow: hypoFromCashFlow,
              fromExpenseReduction: hypoFromExpenseReduction,
            },
          }
        : {}),
      totalIncome,
      totalExpenses,
      netCashFlow,
      portfolioAssets,
      accountLedgers,
      accountBasisBoY,
      liabilityBalancesBoY,
      ...(Object.keys(notesReceivableByNote).length > 0
        ? {
            notesReceivableByNote,
            notesReceivableTotals: {
              interest: notesYearResult.totals.interest,
              principalLTCG: notesYearResult.totals.principalLTCG,
              principalBasis: notesYearResult.totals.principalBasis,
              totalCashIn: notesYearResult.totals.totalCashIn,
              householdCashIn: householdNoteCashIn,
            },
          }
        : {}),
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
       || noteShortfallWarnings.length > 0
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
                ...noteShortfallWarnings,
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
        relocations: data.relocations,
        gifts: data.gifts ?? [],
        giftEvents: data.giftEvents,
        yearEndAccountBalances,
        annualExclusionsByYear,
        dsueReceived: 0, // first decedent has no prior DSUE
        priorTaxableGifts: data.planSettings.priorTaxableGifts ?? { client: 0, spouse: 0 },
        entityAccountSharesEoY: lockedEntityShareCarry,
        familyAccountSharesEoY: lockedFamilyShareCarry,
        // Survivor birth year + LE so first-death can extend a continued
        // deferred income to the survivor's death year. Mirrors
        // computeFirstDeathYear's arithmetic (spouseLifeExpectancy ?? 95).
        survivorBirthYear: parseInt(
          (firstDeathSurvivor === "spouse" ? client.spouseDob : client.dateOfBirth)!.slice(0, 4), 10),
        survivorLifeExpectancy:
          firstDeathSurvivor === "spouse" ? (client.spouseLifeExpectancy ?? 95) : (client.lifeExpectancy ?? 95),
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

      // Life-insurance payouts transformed policy accounts into taxable proceeds
      // accounts. `effectiveWithdrawalStrategy` was snapshotted at projection
      // start when those accounts were still `life_insurance` (no withdrawal
      // priority), so without this they are never drawn — retirement assets
      // liquidate ahead of available proceeds. Insert each into the taxable
      // tier. (Final-death payouts need no entry: the projection terminates
      // that year, so there are no further withdrawals to satisfy.)
      appendProceedsToWithdrawalStrategy(
        effectiveWithdrawalStrategy,
        deathResult.lifeInsurancePayouts.map((p) => p.policyId),
        workingAccounts,
        year,
        planSettings.planEndYear,
      );

      // Attach to the just-built ProjectionYear
      const thisYear = years[years.length - 1];
      // The §13 snapshot was taken pre-death. Recompute against the post-death
      // account state so the life-insurance payout (and every other death-event
      // transfer) shows in the death year itself.
      thisYear.portfolioAssets = computePortfolioSnapshot({
        workingAccounts,
        accountBalances,
        giftEvents: data.giftEvents,
        year,
        planStartYear: planSettings.planStartYear,
        entityMap,
        principalFmIds,
      });
      thisYear.deathTransfers = deathResult.transfers;
      // F17: surface the silent age-95 default applied when a spouse DOB is
      // present but no spouse life expectancy was provided. Emitted once, at
      // the first-death attachment (this block runs only in the first-death
      // year), so the warning never double-fires across years or with the
      // final-death merge below.
      thisYear.deathWarnings = isSpouseLifeExpectancyDefaulted(client)
        ? [...deathResult.warnings, "spouse_life_expectancy_defaulted"]
        : deathResult.warnings;
      thisYear.estateTax = deathResult.estateTax;
      foldLifeInsurancePayoutsIntoIncome(thisYear, deathResult.lifeInsurancePayouts);

      // Stash DSUE for the final-death call (portability per §2010(c)(4)).
      stashedDSUE = deathResult.dsueGenerated;

      // Freeze the real first death so every subsequent year's hypothetical
      // anchors to it (survivor-dies-at-N) rather than re-running the first
      // death against the now-drained post-death state. `firstDeathDeceased` is
      // narrowed to "client" | "spouse" by this block's guard.
      realFirstDeath = {
        decedent: firstDeathDeceased,
        estateTax: deathResult.estateTax,
        transfers: deathResult.transfers,
        dsueGenerated: deathResult.dsueGenerated,
      };
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
        relocations: data.relocations,
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
      foldLifeInsurancePayoutsIntoIncome(thisYear, finalResult.lifeInsurancePayouts);

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

  // Account-as-asset businesses: register top-level business accounts as
  // first-class cashflow rows alongside legacy entity-modeled businesses.
  // Same downstream key space (year.entityCashFlow) — UI reads via the same
  // dropdown selection.
  const businessAccountsById = new Map<string, BusinessAccountMetadata>();
  for (const acct of data.accounts) {
    if (acct.category !== "business") continue;
    if (acct.parentAccountId != null) continue;
    businessAccountsById.set(acct.id, {
      id: acct.id,
      name: acct.name,
      businessType: acct.businessType,
      flowMode: acct.flowMode,
      distributionPolicyPercent: acct.distributionPolicyPercent,
    });
  }
  computeBusinessAccountCashFlow({
    years,
    businessAccountsById,
    accounts: data.accounts,
    incomes: currentIncomes,
    expenses: lastAllExpenses,
    accountFlowOverrides: data.accountFlowOverrides,
  });

  // Future-activated business accounts: `computeBusinessAccountCashFlow` walks
  // per-year value off ledgers (skips accounts with no ledger, so pre-activation
  // years contribute $0 to the value walk) BUT its income/expense/distribution
  // fields come from `computeBusinessYearFlow`, which gates only on the income
  // row's own start/end year — not the account's `activationYear`. Without this
  // strip, a business account whose income rows start before it activates would
  // surface a phantom cashflow row (income + distributions) before the account
  // exists. Mirror the Phase-3 tax gate: drop the row for any year before the
  // account's activation year. No-op for accounts without `activationYear`.
  for (const acct of businessAccountsById.keys()) {
    const account = data.accounts.find((a) => a.id === acct);
    if (account?.activationYear == null) continue;
    for (const year of years) {
      if (isPreActivation(account, year.year)) {
        year.entityCashFlow.delete(acct);
      }
    }
  }

  // Per-family-member locked-share ledger for jointly-held accounts. Only
  // accounts with ≥2 distinct family-member owners get a per-member ledger.
  const accountFamilyOwners = new Map<string, Array<{ familyMemberId: string; percent: number }>>();
  for (const acct of data.accounts ?? []) {
    const fmOwners = (acct.owners ?? [])
      .filter((o) => o.kind === "family_member")
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
      year.portfolioAssets.lifeInsuranceTotal +
      year.portfolioAssets.stockOptionsTotal;
    // H1: keep the canonical liquid total in sync after the re-bucket — it feeds
    // the chart/cell/BoY and includes accessibleTrustAssetsTotal, which this pass
    // can change. Mirrors computePortfolioSnapshot.
    year.portfolioAssets.liquidTotal =
      year.portfolioAssets.taxableTotal +
      year.portfolioAssets.cashTotal +
      year.portfolioAssets.retirementTotal +
      year.portfolioAssets.lifeInsuranceTotal +
      year.portfolioAssets.accessibleTrustAssetsTotal;
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

  // Future-activated accounts don't exist "today": an account whose
  // activationYear is after plan start is a not-yet-received windfall
  // (e.g. a future inheritance). Including it would inflate the "if they
  // died today" estate with assets the household doesn't hold. Filter the
  // account list AND the balance/basis maps from the same set — the
  // first-death chain throws on any account missing an accountBalances
  // entry (first-death.ts), so the two must stay consistent.
  const todayAccounts = data.accounts.filter(
    (acct) => acct.activationYear == null || acct.activationYear <= planStartYear,
  );

  const accountBalances: Record<string, number> = {};
  const basisMap: Record<string, number> = {};
  for (const acct of todayAccounts) {
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

  // "Married" for the hypothetical means "a spouse exists to die second" — the
  // same signal the real projection uses to schedule the second death (see
  // computeFinalDeathYear, which keys off `client.spouseDob`). Deriving this
  // from filingStatus would model only one death for a spouse'd household that
  // files single/separately, routing everything to the surviving spouse under
  // the marital deduction and showing $0 to heirs in the "Today" estate view.
  const isMarried = data.client.spouseDob != null;

  return computeHypotheticalEstateTax({
    year: planStartYear,
    isMarried,
    accounts: todayAccounts,
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
    annualExclusionsByYear: buildAnnualExclusionsMap(data.taxYearRows ?? [], data.planSettings),
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
  const annualExclusionsByYear = buildAnnualExclusionsMap(data.taxYearRows ?? [], data.planSettings);
  const giftLedger = computeGiftLedger({
    planStartYear: data.planSettings.planStartYear,
    planEndYear: data.planSettings.planEndYear,
    hasSpouse: data.client.spouseDob != null,
    priorTaxableGifts: data.planSettings.priorTaxableGifts ?? { client: 0, spouse: 0 },
    gifts: data.gifts ?? [],
    giftEvents: data.giftEvents ?? [],
    entities: data.entities ?? [],
    externalBeneficiaries: (data.externalBeneficiaries ?? [])
      .filter((e) => e.kind != null)
      .map((e) => ({ id: e.id, kind: e.kind! })),
    annualExclusionsByYear,
    taxInflationRate: data.planSettings.taxInflationRate ?? data.planSettings.inflationRate ?? 0,
    lifetimeExemptionCap: data.planSettings.lifetimeExemptionCap ?? null,
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
