// src/engine/entity-cashflow.ts
import type {
  Account,
  AccountFlowOverride,
  ClientInfo,
  EntityFlowMode,
  EntityFlowOverride,
  Expense,
  Income,
  ProjectionYear,
} from "./types";
import { resolveEntityFlows } from "./entity-flows";
import { accrueLockedEntityShare } from "./locked-shares";
import { collectBusinessTree } from "./business/business-tree";
import { computeBusinessYearFlow } from "./business/year-flow";
import type { TrustSubType } from "./types";

/** Business types accepted by the account-as-asset model. `sole_prop` is
 *  account-only — the legacy entity union has no equivalent and gets mapped to
 *  `"other"` when surfacing through the business-cashflow report. */
type AccountBusinessType =
  | "sole_prop"
  | "partnership"
  | "s_corp"
  | "c_corp"
  | "llc"
  | "other";

const PASS_THROUGH_BUSINESS_TYPES: ReadonlySet<AccountBusinessType> = new Set([
  "sole_prop",
  "partnership",
  "s_corp",
  "llc",
]);

function mapAccountBusinessTypeToEntityType(
  businessType: AccountBusinessType | null | undefined,
): "llc" | "s_corp" | "c_corp" | "partnership" | "foundation" | "other" {
  switch (businessType) {
    case "llc":
    case "s_corp":
    case "c_corp":
    case "partnership":
      return businessType;
    case "sole_prop":
    case "other":
    case null:
    case undefined:
      return "other";
  }
}

interface BaseEntityCashFlowRow {
  entityId: string;
  entityName: string;
  year: number;
  ages: { client: number; spouse?: number };
}

export interface TrustCashFlowRow extends BaseEntityCashFlowRow {
  kind: "trust";
  trustSubType: TrustSubType;
  isGrantor: boolean;
  beginningBalance: number;
  transfersIn: number;
  growth: number;
  income: number;
  totalDistributions: number;
  expenses: number;
  taxes: number;
  endingBalance: number;
  /** Realized capital gain on asset sales attributed to this trust this year.
   *  Only populated for grantor trusts (the gain is taxed on the grantor's
   *  1040; the tax ledger renders an offsetting pass-through so the entity
   *  section nets to 0). Net of selling costs, before any §121 exclusion. */
  assetSaleCapitalGain?: number;
}

export interface BusinessCashFlowRow extends BaseEntityCashFlowRow {
  kind: "business";
  entityType: "llc" | "s_corp" | "c_corp" | "partnership" | "foundation" | "other";
  beginningTotalValue: number;
  beginningBasis: number;
  growth: number;
  income: number;
  expenses: number;
  annualDistribution: number;
  retainedEarnings: number;
  endingTotalValue: number;
  endingBasis: number;
}

export type EntityCashFlowRow = TrustCashFlowRow | BusinessCashFlowRow;

/** An entity's end-of-year value, read off its cash-flow row: a business row's
 *  `endingTotalValue`, a trust row's `endingBalance`; 0 when the projection has
 *  no row for it that year. A `business_interest` gift with no explicit amount
 *  values at this × its percent, so the gift ledger and every surface that
 *  re-values the same gift read it through here. */
export function buildEntityValueAtYear(
  years: ProjectionYear[],
): (entityId: string, year: number) => number {
  const yearByYear = new Map(years.map((y) => [y.year, y]));
  return (entityId, year) => {
    const row = yearByYear.get(year)?.entityCashFlow.get(entityId);
    if (!row) return 0;
    return row.kind === "business" ? row.endingTotalValue : row.endingBalance;
  };
}

export interface EntityMetadata {
  id: string;
  name: string;
  entityType: "trust" | "llc" | "s_corp" | "c_corp" | "partnership" | "foundation" | "other";
  trustSubType: TrustSubType | null;
  isGrantor: boolean;
  /** entities.value at plan start. Only meaningful for businesses. */
  initialValue: number;
  initialBasis: number;
  flowMode?: EntityFlowMode;
  /** Annual compound growth rate applied to `initialValue`. Null/undefined
   *  means 0 (no growth — preserves the pre-2026 flat-value behavior).
   *  Business-entity only. */
  valueGrowthRate?: number | null;
}

/** Compound a business entity's flat valuation forward to year-N. The "+1"
 *  offset means year 0 (planStartYear) reports EoY of year 0 = initialValue × (1+g),
 *  matching how account ledgers grow (BoY → growth → EoY). */
export function flatBusinessValueAt(
  initialValue: number,
  growthRate: number | null | undefined,
  year: number,
  planStartYear: number,
): { prior: number; now: number; growth: number } {
  const yrs = year - planStartYear;
  const g = growthRate ?? 0;
  const prior = initialValue * Math.pow(1 + g, yrs);
  const now = initialValue * Math.pow(1 + g, yrs + 1);
  return { prior, now, growth: now - prior };
}

export interface ComputeEntityCashFlowInput {
  years: ProjectionYear[];
  /** Entity metadata indexed by id. */
  entitiesById: Map<string, EntityMetadata>;
  /** Account → EVERY entity owner, resolved AT A GIVEN YEAR (empty when no
   *  entity owns it). Split ownership is supported, including an account split
   *  between two entities: each contributes to its own rollup proportionally
   *  to its `percent`. Was a year-invariant Map, which is precisely why a trust
   *  that received an account by gift never appeared: the account has no
   *  AUTHORED entity row, so it never entered the map and every balance summed
   *  to 0 — while the balance sheet, reading the same account through the
   *  overlay, showed the trust holding it. */
  accountEntityOwnersAt: (
    accountId: string,
    year: number,
  ) => Array<{ entityId: string; percent: number }>;
  /** Every account id any entity could own in any year. The function above
   *  cannot be enumerated, so the caller supplies the candidate set. */
  candidateAccountIds: string[];
  /** The account's `giftsReflectedThrough` in a year, when it is a family pool
   *  a death partition rebuilt. A lock carried from a year at or before it
   *  belonged to the account BEFORE the partition — those dollars left as the
   *  entity's own slice — so it is dropped, never resumed on the pool. */
  giftsReflectedThroughAt?: (accountId: string, year: number) => number | undefined;
  /** Gifts to entities, grouped by recipient entity id and year. */
  giftsByEntityYear: Map<string, Map<number, number>>;
  /** The same resolved currentIncomes array runProjection built. Used by
   *  the business branch to derive per-entity gross income via
   *  resolveEntityFlowAmount (Phase 2 overrides win). */
  incomes: Income[];
  /** The same resolved allExpenses array runProjection built. Same usage. */
  expenses: Expense[];
  /** Phase 2 entity flow overrides (per-entity per-year sparse cells).
   *  Pass-through to resolveEntityFlowAmount so the business branch picks
   *  up Schedule-grid edits the same way the engine does. */
  entityFlowOverrides: EntityFlowOverride[];
  /** Optional. When supplied, the no-override growth-mode fallback in
   *  resolveEntityFlowAmount applies retirement-month proration so the
   *  cashflow report matches the engine's per-row crediting. */
  client?: ClientInfo;
}

export interface BusinessAccountMetadata {
  /** Top-level business account id. */
  id: string;
  /** Display name. */
  name: string;
  /** Underlying business legal form. `null` is permitted at the schema level
   *  but renders as `"other"` in the report's type column. */
  businessType: AccountBusinessType | null | undefined;
  flowMode?: EntityFlowMode;
  distributionPolicyPercent?: number | null;
}

export interface ComputeBusinessAccountCashFlowInput {
  years: ProjectionYear[];
  /** Top-level business-account metadata indexed by account id. Child
   *  accounts in the business tree are NOT included here — the function
   *  walks the tree from each top-level id to roll up consolidated value. */
  businessAccountsById: Map<string, BusinessAccountMetadata>;
  /** All accounts (used to walk each business's tree for consolidated
   *  value/growth/basis). */
  accounts: Account[];
  /** Same resolved currentIncomes / allExpenses arrays runProjection built.
   *  Passed straight through to computeBusinessYearFlow so the report's
   *  income/expense column matches what the engine taxed/distributed. */
  incomes: Income[];
  expenses: Expense[];
  /** Per-year (income, expense, distribution%) override grid for business
   *  accounts in schedule mode. */
  accountFlowOverrides?: AccountFlowOverride[];
}

/**
 * Mutates input.years[].entityCashFlow in place, populating one
 * EntityCashFlowRow per entity per year (skipping years where the entity
 * has no presence).
 */
export function computeEntityCashFlow(input: ComputeEntityCashFlowInput): void {
  const { years, entitiesById, accountEntityOwnersAt, candidateAccountIds } = input;

  // Entity → account list, unioned across EVERY year. Split ownership is
  // allowed; the share is applied per year during the rollup. Built from one
  // year only (or from the authored owners) this misses exactly the accounts
  // an entity does not own until a mid-horizon gift.
  const accountsByEntity = new Map<string, string[]>();
  for (const year of years) {
    for (const accountId of candidateAccountIds) {
      for (const owner of accountEntityOwnersAt(accountId, year.year)) {
        const list = accountsByEntity.get(owner.entityId) ?? [];
        if (!list.includes(accountId)) list.push(accountId);
        accountsByEntity.set(owner.entityId, list);
      }
    }
  }

  const planStart = years[0]?.year ?? 0;

  // Per-entity per-account locked EoY share for split-owned accounts. Carries
  // year-over-year so household-driven flows on the joint account never bleed
  // into the entity's reported share.
  // The percent each carry was locked at rides along, so a later gift that
  // raises the share tops the carry up instead of being ignored.
  // …and the year it was locked in, for the partition reset below.
  const lockedShareByEntityAccount = new Map<string, Map<string, { eoy: number; percent: number; year: number }>>();

  for (const year of years) {
    for (const [entityId, entity] of entitiesById) {
      const accountIds = accountsByEntity.get(entityId) ?? [];
      let beginningBalance = 0;
      let endingBalance = 0;
      let growth = 0;
      let income = 0;
      let expenses = 0;
      // Sum of (account basis × ownership share) for entity-owned accounts.
      // Each owned account contributes its BoY basis (from year.accountBasisBoY)
      // scaled by the entity's ownership percent.
      let accountBasis = 0;
      for (const aid of accountIds) {
        const owner = accountEntityOwnersAt(aid, year.year).find((o) => o.entityId === entityId);
        // 0, not 1. An account in `accountsByEntity` but not owned by THIS
        // entity in THIS year is one it does not own YET — a later gift put it
        // in the union. The old `?? 1` was unreachable (the union and the map
        // were the same object) and would now book the whole pre-gift balance.
        const share = owner?.percent ?? 0;
        if (share <= 0) continue;
        // Publish this year's resolved ownership so report surfaces (trust
        // drill-down, asset ledger) read the same answer this row books.
        if (!year.entityAccountOwners) year.entityAccountOwners = new Map();
        let owned = year.entityAccountOwners.get(entityId);
        if (!owned) {
          owned = new Map();
          year.entityAccountOwners.set(entityId, owned);
        }
        owned.set(aid, share);
        const ledger = year.accountLedgers[aid];
        if (!ledger) continue;
        accountBasis += (year.accountBasisBoY?.[aid] ?? 0) * share;
        // Tolerance, not `=== 1`: gift percents are summed, and a composed
        // 0.9999999… would otherwise fall into the split branch and drop the
        // account's income and expenses from the entity row.
        if (share >= 1 - 1e-9) {
          // Fully entity-owned — the account's full activity belongs to the entity.
          beginningBalance += ledger.beginningValue;
          endingBalance += ledger.endingValue;
          growth += ledger.growth;
          for (const entry of ledger.entries) {
            if (entry.isInternalTransfer) continue;
            // Asset-sale proceeds are an asset→cash conversion, not income —
            // exclude them so the trust/business income column (and the
            // grantor-trust 1040 pass-through) isn't inflated by gross proceeds.
            if (entry.isSaleProceeds) continue;
            // Distribution debits are booked as `entity_distribution` and
            // reported in `totalDistributions` below, so they stay out of here.
            if (entry.category === "income") income += Math.abs(entry.amount);
            if (entry.category === "expense") expenses += Math.abs(entry.amount);
          }
        } else {
          // Split-owned — entity's share is locked to (carried EoY share or
          // initial BoY × percent) plus its share of passive growth. Flow
          // entries on the account are treated as household-attributable.
          let carried = lockedShareByEntityAccount.get(entityId)?.get(aid);
          const reflected = input.giftsReflectedThroughAt?.(aid, year.year);
          if (carried && reflected != null && carried.year <= reflected) carried = undefined;
          const acc = accrueLockedEntityShare({
            carriedBoY: carried?.eoy,
            carriedPercent: carried?.percent,
            ledger: {
              beginningValue: ledger.beginningValue,
              growth: ledger.growth,
              endingValue: ledger.endingValue,
            },
            percent: share,
          });
          beginningBalance += acc.lockedBoY;
          endingBalance += acc.lockedEoY;
          growth += acc.lockedGrowth;
          if (!lockedShareByEntityAccount.has(entityId)) {
            lockedShareByEntityAccount.set(entityId, new Map());
          }
          lockedShareByEntityAccount.get(entityId)!.set(aid, { eoy: acc.lockedEoY, percent: share, year: year.year });
          // Expose to consumers (balance sheet, reports) so they can render
          // the same locked share rather than ledger.endingValue × percent.
          if (!year.entityAccountSharesEoY) {
            year.entityAccountSharesEoY = new Map();
          }
          if (!year.entityAccountSharesEoY.has(entityId)) {
            year.entityAccountSharesEoY.set(entityId, new Map());
          }
          year.entityAccountSharesEoY.get(entityId)!.set(aid, acc.lockedEoY);
        }
      }
      let totalDistributions = year.trustDistributionsByEntity?.get(entityId) ?? 0;
      if (entity.entityType === "trust") {
        for (const o of year.charitableOutflowDetail ?? []) {
          if (o.trustId === entityId) totalDistributions += o.amount;
        }
        for (const t of year.trustTerminations ?? []) {
          if (t.trustId === entityId) totalDistributions += t.totalDistributed;
        }
      }

      let transfersIn = 0;
      if (entity.entityType === "trust") {
        const giftsForEntity = input.giftsByEntityYear.get(entityId);
        if (giftsForEntity) transfersIn += giftsForEntity.get(year.year) ?? 0;
        for (const t of year.deathTransfers ?? []) {
          if (t.recipientKind === "entity" && t.recipientId === entityId) {
            transfersIn += t.amount;
          }
        }
      }

      let taxes = 0;
      if (entity.entityType === "trust" && !entity.isGrantor) {
        const tt = year.trustTaxByEntity?.get(entityId);
        if (tt) taxes = tt.total;
      }

      if (entity.entityType === "trust") {
        year.entityCashFlow.set(entityId, {
          kind: "trust",
          entityId,
          entityName: entity.name,
          year: year.year,
          ages: year.ages,
          trustSubType: entity.trustSubType ?? "irrevocable",
          isGrantor: entity.isGrantor,
          beginningBalance,
          transfersIn,
          growth,
          income,
          totalDistributions,
          expenses,
          taxes,
          endingBalance,
          assetSaleCapitalGain: year.grantorCapGainsByEntity?.get(entityId) ?? 0,
        });
      } else {
        // Business branch: llc | s_corp | c_corp | partnership | foundation | other.
        const { prior: flatValuePrior, growth: flatGrowthThisYear } =
          flatBusinessValueAt(entity.initialValue, entity.valueGrowthRate, year.year, planStart);
        const beginningTotalValue = flatValuePrior + beginningBalance;
        const totalGrowth = growth + flatGrowthThisYear;

        // Derive per-entity gross income/expenses via resolveEntityFlows so
        // Phase 2 per-year overrides win + the same inflate-from convention
        // applies as in computeBusinessEntityNetIncome. Schedule mode reads
        // the override grid directly (no base row required).
        const flowMode = entity.flowMode ?? "annual";
        const { income: bizIncome, expense: bizExpenses } = resolveEntityFlows(
          entityId,
          input.incomes,
          input.expenses,
          year.year,
          input.entityFlowOverrides,
          flowMode,
          input.client,
        );

        // Annual distribution = sum of |entity_distribution| debits on entity-owned
        // accounts. The engine writes a debit on entity checking and a credit on
        // household checking (Phase 3 wiring); this side reads the entity-side debit.
        let annualDistribution = 0;
        for (const aid of accountIds) {
          const ledger = year.accountLedgers[aid];
          if (!ledger) continue;
          for (const entry of ledger.entries) {
            if (entry.category !== "entity_distribution") continue;
            if (entry.amount < 0) annualDistribution += Math.abs(entry.amount);
          }
        }

        const netIncome = bizIncome - bizExpenses;
        const retainedEarnings = netIncome - annualDistribution;
        const endingTotalValue = beginningTotalValue + totalGrowth + retainedEarnings;
        // Outside basis = entity-level basis + owner's share of owned-account basis.
        const beginningBasis = entity.initialBasis + accountBasis;
        // Pass-through entities (grantor / S-corp / partnership): retained
        // earnings have already been taxed at the owner level, so they
        // increase basis. C-corp / foundation / other: retained earnings
        // sit at the entity level untaxed-to-owner, so basis stays flat.
        // LLCs default to partnership taxation (multi-member) or disregarded
        // (single-member); both pass income through to the owner's 1040 each
        // year, so retained earnings bump outside basis. See spec
        // 2026-05-11-business-distribution-passthrough-design § Section C.
        const isPassThrough =
          entity.isGrantor === true ||
          entity.entityType === "s_corp" ||
          entity.entityType === "partnership" ||
          entity.entityType === "llc";
        const basisDelta = isPassThrough ? retainedEarnings : 0;
        const endingBasis = beginningBasis + basisDelta;

        year.entityCashFlow.set(entityId, {
          kind: "business",
          entityId,
          entityName: entity.name,
          year: year.year,
          ages: year.ages,
          entityType: entity.entityType,
          beginningTotalValue,
          beginningBasis,
          growth: totalGrowth,
          income: bizIncome,
          expenses: bizExpenses,
          annualDistribution,
          retainedEarnings,
          endingTotalValue,
          endingBasis,
        });
      }
    }
  }
}

/**
 * Account-as-asset counterpart of {@link computeEntityCashFlow}. Walks each
 * top-level business account's tree (parent + descendants) to roll up
 * consolidated beginning/ending value, growth, and basis. Income/expense
 * (and the implied distribution amount) come from `computeBusinessYearFlow`,
 * matching what the engine taxed and distributed in the Phase 3 blocks.
 *
 * Rows are keyed on the business **account id** (stored in the row's
 * `entityId` field for shape-compatibility with the existing report). The
 * key spaces don't collide because entity ids and account ids are distinct
 * UUIDs from different tables.
 */
export function computeBusinessAccountCashFlow(input: ComputeBusinessAccountCashFlowInput): void {
  const { years, businessAccountsById, accounts } = input;
  if (businessAccountsById.size === 0) return;

  for (const year of years) {
    for (const [accountId, biz] of businessAccountsById) {
      const tree = collectBusinessTree(accountId, accounts);
      // Consolidated value: parent business account + every descendant
      // ledger. Mirrors `consolidatedBusinessValue` but uses ledger fields
      // (begin/end/growth) instead of a static balance map, so the row
      // walks BoY → growth → EoY cleanly. No drained-account exclusion —
      // a paid-down loan account or zero-balance bucket still contributes 0
      // and doesn't distort the walk.
      let beginningTotalValue = 0;
      let endingTotalValue = 0;
      let totalGrowth = 0;
      let beginningBasis = 0;
      for (const a of tree) {
        const ledger = year.accountLedgers[a.id];
        if (!ledger) continue;
        beginningTotalValue += ledger.beginningValue;
        endingTotalValue += ledger.endingValue;
        totalGrowth += ledger.growth;
        beginningBasis += year.accountBasisBoY?.[a.id] ?? 0;
      }

      const business = accounts.find((a) => a.id === accountId);
      if (!business) continue;
      const flow = computeBusinessYearFlow(
        business,
        year.year,
        input.incomes,
        input.expenses,
        input.accountFlowOverrides,
      );
      const netIncome = flow.gross - flow.exp;
      // Match the engine's distribution rule (projection.ts Phase 3):
      // losses (netIncome ≤ 0) → no distribution. distPercent is the
      // resolved account-level or schedule-cell percent, defaulting to 1.0.
      const annualDistribution = netIncome > 0 ? netIncome * flow.distPercent : 0;
      const retainedEarnings = netIncome - annualDistribution;

      // Pass-through types accumulate retained earnings into outside basis;
      // C-corp / other keep basis flat. Same rule as the entity branch.
      const isPassThrough =
        biz.businessType != null && PASS_THROUGH_BUSINESS_TYPES.has(biz.businessType);
      const endingBasis = beginningBasis + (isPassThrough ? retainedEarnings : 0);

      year.entityCashFlow.set(accountId, {
        kind: "business",
        entityId: accountId,
        entityName: biz.name,
        year: year.year,
        ages: year.ages,
        entityType: mapAccountBusinessTypeToEntityType(biz.businessType),
        beginningTotalValue,
        beginningBasis,
        growth: totalGrowth,
        income: flow.gross,
        expenses: flow.exp,
        annualDistribution,
        retainedEarnings,
        endingTotalValue,
        endingBasis,
      });
    }
  }
}
