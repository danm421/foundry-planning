// src/components/balance-sheet-report/view-model.ts
//
// Slice-based view-model. Each account is expanded into one row per
// owner slice (family member or entity) so the report can display
// proportional ownership and route slices to in-estate, out-of-estate,
// or per-entity buckets without the lossy binary `owner | ownerEntityId`
// shape the old version used.

import type { AccountOwner, EntityOwner } from "@/engine/ownership";
import type { FamilyMember } from "@/engine/types";
import { flatBusinessValueAt } from "@/engine/entity-cashflow";
import { collectBusinessTree } from "@/engine/business/business-tree";
import { resolveOwnerSlices } from "@/lib/estate/account-owner-slices";
import type { OwnershipView } from "./ownership-filter";
import { yoyPct, sliceBarAnchors, type YoyResult } from "./yoy";
import { CATEGORY_ORDER, CATEGORY_LABELS, CATEGORY_HEX, type AssetCategoryKey } from "./tokens";

// ── Input shapes ─────────────────────────────────────────────────────────────

export interface AccountLike {
  id: string;
  name: string;
  category: string; // "cash" | "taxable" | "retirement" | "real_estate" | "business" | "life_insurance"
  owners: AccountOwner[];
  /** Business-as-asset model: a sub-account (operating cash, real estate held
   *  inside the business, etc.) hangs off its parent business account via this
   *  id. Null/undefined for top-level accounts. */
  parentAccountId?: string | null;
  /** Business-as-asset model: legal type on a top-level business account
   *  (`category === "business"`, `parentAccountId == null`). Drives the
   *  entity-card type chip on the By-Entity tab. */
  businessType?: string | null;
  /** Set when the account is tagged into a revocable trust. Drives the
   *  balance-sheet badge. Does not affect grouping or values. */
  revocableTrustName?: string | null;
}

export interface LiabilityLike {
  id: string;
  name: string;
  owners: AccountOwner[];
  linkedPropertyId?: string | null;
  /** Business-as-asset model: a debt carried by a business hangs off its
   *  parent business account via this id. */
  parentAccountId?: string | null;
}

export interface ProjectionYearLike {
  year: number;
  portfolioAssets: {
    cash: Record<string, number>;
    taxable: Record<string, number>;
    retirement: Record<string, number>;
    realEstate: Record<string, number>;
    business: Record<string, number>;
    lifeInsurance: Record<string, number>;
    total: number;
  };
  liabilityBalancesBoY: Record<string, number>;
  /** Per-account EOY balance for every account (including entity-owned).
   *  The balance sheet sources row values from here so trust-owned and
   *  business-owned accounts surface in the report regardless of their
   *  treatment in the engine's portfolio-assets totals. */
  accountLedgers: Record<string, { endingValue: number; beginningValue: number }>;
  /** Engine-emitted locked entity share for split-owned accounts: entityId →
   *  accountId → entity's EoY dollar share. When present, the balance sheet
   *  uses this in place of `ledger.endingValue × ownerPercent` so the entity
   *  view matches the cash-flow report and household drains don't bleed into
   *  the entity's share. */
  entityAccountSharesEoY?: Map<string, Map<string, number>>;
  /** Engine-emitted locked family-member share for jointly-held accounts:
   *  familyMemberId → accountId → that member's EoY dollar share. Populated
   *  by computeFamilyAccountShares for accounts with ≥2 family-member owners.
   *  When present in EoY mode, the balance sheet uses these slices in place
   *  of `value × authored ownerPercent` so projected percentages reflect drift
   *  from the original split. */
  familyAccountSharesEoY?: Map<string, Map<string, number>>;
}

export interface EntityInfo {
  id: string;
  name: string;
  /** "trust" | "llc" | "s_corp" | "c_corp" | "partnership" | "foundation" | "other" */
  entityType: string;
  /** Trusts only. Undefined → treat as revocable (in-estate). */
  isIrrevocable?: boolean;
  /** Business-entity flat valuation at plan start. Year-N projection is
   *  computed inside the view-model using `valueGrowthRate` + `planStartYear`. */
  value?: number;
  /** Annual compound growth rate for the flat business value. Null/undefined
   *  means 0% (pre-2026 flat-value behavior). */
  valueGrowthRate?: number | null;
  /** Polymorphic entity_owners rows for a business entity. Mixed family-member
   *  and entity (e.g. trust-holds-business) owners. Trusts leave this undefined.
   *  When entirely absent (legacy data), the business is treated as fully
   *  family-owned for back-compat. */
  owners?: EntityOwner[];
}

export type AsOfMode = "today" | "eoy";

export interface BuildViewModelInput {
  accounts: AccountLike[];
  liabilities: LiabilityLike[];
  entities: EntityInfo[];
  /** Used to resolve family-member slices to their household role. */
  familyMembers: FamilyMember[];
  projectionYears: ProjectionYearLike[];
  selectedYear: number;
  view: OwnershipView;
  /** "today" = beginning-of-year balances for the first projection year
   * (the advisor-entered current balances). "eoy" = end-of-year balances
   * for the selected year. Default: "eoy". */
  asOfMode?: AsOfMode;
}

// ── Output shape ─────────────────────────────────────────────────────────────

export interface AssetRow {
  /** Composite key: `${accountId}` for whole-account rows, or
   *  `${accountId}#${ownerKey}` for proportional slices. Unique within the
   *  view-model output so React lists are stable. */
  rowKey: string;
  /** Underlying account (or entity for flat-value rows). */
  accountId: string;
  accountName: string;
  /** Household role of this slice when family-owned, or null for entity
   *  slices and flat business-value rows. */
  owner: "client" | "spouse" | "joint" | null;
  /** Set when this slice belongs to an entity. */
  ownerEntityId: string | null;
  /** Fraction of the underlying account this slice represents. < 1 means
   *  the account has multiple owners and this is just one slice. */
  ownerPercent: number;
  /** Human-readable owner label baked in by the view-model so the panel
   *  doesn't have to reconstruct it. Examples: "Client", "Smith LLC". */
  ownerLabel: string;
  value: number;
  hasLinkedMortgage: boolean;
  /** True when this row represents a business-entity flat valuation rather
   *  than a real account. Renders distinctly. */
  isFlatBusinessValue: boolean;
  /** True when the source account has ≥2 owners. Used by OwnerChip to keep
   *  the percent label visible on multi-owner accounts even when a slice has
   *  drifted to ~0% / ~100%. False for single-owner accounts and flat
   *  business-value rows. */
  accountHasMultipleOwners: boolean;
  /** Trust name when the source account is tagged into a revocable trust. */
  revocableTrustName?: string | null;
}

export interface AssetCategoryGroup {
  key: AssetCategoryKey;
  label: string;
  total: number;
  rows: AssetRow[];
  yoy: YoyResult | null;
}

export interface LiabilityRow {
  rowKey: string;
  liabilityId: string;
  liabilityName: string;
  owner: "client" | "spouse" | "joint" | null;
  ownerEntityId: string | null;
  ownerPercent: number;
  ownerLabel: string;
  balance: number;
}

export type OutOfEstateOwnerType =
  | "trust" | "foundation" | "business" | "person" | "entity" | "external";

export interface OutOfEstateOwnerRow {
  /** "en:<entityId>" | "fm:<familyMemberId>" | "ext" */
  ownerKey: string;
  ownerName: string;
  ownerType: OutOfEstateOwnerType;
  assetTotal: number;
  liabilityTotal: number;
  /** assetTotal - liabilityTotal */
  net: number;
}

export interface DonutSlice {
  key: AssetCategoryKey;
  label: string;
  value: number;
  hex: string;
}

export interface BarChartPoint {
  year: number;
  assets: number;
  liabilities: number;
}

/** One card per entity in the "entities" view. Each entity surfaces every
 *  slice it owns (across all categories) plus its flat business valuation
 *  if applicable. */
export interface EntityGroup {
  entityId: string;
  entityName: string;
  entityType: string;
  assetRows: AssetRow[];
  assetTotal: number;
  liabilityRows: LiabilityRow[];
  liabilityTotal: number;
  netWorth: number;
}

export interface BalanceSheetViewModel {
  selectedYear: number;
  assetCategories: AssetCategoryGroup[];
  /** Entity-owned slices that fall outside the household estate (irrevocable
   *  trusts, foundations, non-family-owned shares of business entities).
   *  Populated only in the consolidated view. Does NOT contribute to
   *  totalAssets / netWorth / donut / realEstateEquity. */
  outOfEstateRows: AssetRow[];
  outOfEstateLiabilityRows: LiabilityRow[];
  outOfEstateNetWorth: number;
  /** One net line per out-of-estate owner (entities, child/other people,
   *  external beneficiaries). Consolidated view only; [] otherwise. */
  outOfEstateOwnerRows: OutOfEstateOwnerRow[];
  liabilityRows: LiabilityRow[];
  /** Present only when view === "entities". */
  entityGroups?: EntityGroup[];
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
  realEstateEquity: number;
  donut: DonutSlice[];
  barChartSeries: BarChartPoint[];
  yoy: {
    totalAssets: YoyResult | null;
    totalLiabilities: YoyResult | null;
    netWorth: YoyResult | null;
  };
}

// ── Constants & helpers ──────────────────────────────────────────────────────

const BUSINESS_ENTITY_TYPES = new Set(["llc", "s_corp", "c_corp", "partnership", "other"]);

const DB_TO_KEY: Record<string, AssetCategoryKey> = {
  cash: "cash",
  taxable: "taxable",
  retirement: "retirement",
  annuity: "annuity",
  real_estate: "realEstate",
  business: "business",
  life_insurance: "lifeInsurance",
};

function findPriorYear(
  projectionYears: ProjectionYearLike[],
  selectedYear: number,
): ProjectionYearLike | null {
  const idx = projectionYears.findIndex((y) => y.year === selectedYear);
  if (idx <= 0) return null;
  return projectionYears[idx - 1];
}

function accountValueForYear(
  yearData: ProjectionYearLike,
  accountId: string,
  mode: AsOfMode,
): number {
  const ledger = yearData.accountLedgers[accountId];
  if (!ledger) return 0;
  return mode === "today" ? ledger.beginningValue : ledger.endingValue;
}

function isBusinessEntity(e: EntityInfo | undefined): boolean {
  return !!e && BUSINESS_ENTITY_TYPES.has(e.entityType);
}

/** Fraction of a non-trust entity owned by household family members.
 *  Missing `owners` is treated as fully family-owned (legacy back-compat
 *  for data imported before the entity_owners join table). NOTE: this also
 *  counts entity-owners' percents — the original semantic was "total
 *  declared ownership of this business" which the consolidated view treats
 *  as fully in-estate. */
function familyOwnedFraction(entity: EntityInfo): number {
  if (entity.owners == null) return 1;
  const sum = entity.owners.reduce((s, o) => s + (o.percent ?? 0), 0);
  return Math.max(0, Math.min(1, sum));
}

/** Slice classifications:
 *  - "in_estate": counts toward in-estate totals, attributed to the slice's owner.
 *  - "out_of_estate": rendered in the OOE section.
 *  - "drop": foundations and other unrecognized owners. Currently unused
 *    because foundations route to OOE; here for future use.
 */
type SliceClassification = "in_estate" | "out_of_estate";

function classifySlice(
  owner: AccountOwner,
  entitiesById: Map<string, EntityInfo>,
): SliceClassification {
  if (owner.kind === "family_member") return "in_estate";
  // External beneficiaries (death-benefit recipients / charities) never hold
  // present interest in the household estate.
  if (owner.kind === "external_beneficiary") return "out_of_estate";
  // Gifted-away slices have left the estate entirely — same treatment as OOE.
  if (owner.kind === "gifted_away") return "out_of_estate";
  const entity = entitiesById.get(owner.entityId);
  if (!entity) return "out_of_estate";
  if (entity.entityType === "trust") {
    return entity.isIrrevocable ? "out_of_estate" : "in_estate";
  }
  if (isBusinessEntity(entity)) {
    // Business entities always render under their entity card; the
    // in-estate/OOE split is captured separately via familyOwnedFraction
    // when totaling in the consolidated view.
    return "in_estate";
  }
  // Foundations and unknown entity types: out-of-estate.
  return "out_of_estate";
}

interface SliceCommon {
  rowKey: string;
  accountId: string;
  accountName: string;
  category: AssetCategoryKey;
  ownerPercent: number;
  ownerLabel: string;
  /** sliceValue = account_value × percent. */
  value: number;
  hasLinkedMortgage: boolean;
  /** True when the source account has ≥2 owners. Drives the owner-percent
   *  label visibility — multi-owner accounts always show the percent so that
   *  drift to ~0% / ~100% in a given year remains visible. Single-owner
   *  accounts hide the label (it's always 100% by definition). */
  accountHasMultipleOwners: boolean;
  /** Trust name when the source account is tagged into a revocable trust. */
  revocableTrustName?: string | null;
}

interface FamilySlice extends SliceCommon {
  kind: "family";
  role: "client" | "spouse" | "joint";
  familyMemberId: string;
}

interface EntitySlice extends SliceCommon {
  kind: "entity";
  entityId: string;
  /** True when this entity is treated as in-estate (revocable trust, or
   *  family-owned non-trust entity). For non-trust business entities, the
   *  in-estate weight is `familyOwnedFraction(entity)` — an entity may be
   *  "in-estate" overall but partially OOE if family share < 1. */
  inEstate: boolean;
  /** Family-owned share of the entity (1 for trusts; partial for business
   *  entities with non-100% family ownership). Used to split the slice
   *  value between the in-estate Business total and the OOE total. */
  familyShare: number;
}

type Slice = FamilySlice | EntitySlice;

function familyRoleLabel(
  role: "client" | "spouse" | "child" | "other",
): "client" | "spouse" | "joint" {
  // The polished report only distinguishes client/spouse/joint at the
  // ownership-chip level. Children and other family members fall through
  // to "joint" so they still appear in the consolidated view; future
  // work can introduce a dedicated chip if advisors need it.
  if (role === "client") return "client";
  if (role === "spouse") return "spouse";
  return "joint";
}

/** Household roles whose holdings count toward the in-estate balance sheet.
 *  Child / other family members are out-of-estate. */
function isInEstateFamilyRole(
  role: "client" | "spouse" | "child" | "other",
): boolean {
  return role === "client" || role === "spouse";
}

function ownerLabelForFamily(
  role: "client" | "spouse" | "joint",
  firstName: string | undefined,
): string {
  if (firstName) return firstName;
  if (role === "client") return "Client";
  if (role === "spouse") return "Spouse";
  return "Joint";
}

// ── Builder ──────────────────────────────────────────────────────────────────

export function buildViewModel(input: BuildViewModelInput): BalanceSheetViewModel {
  const { accounts, liabilities, entities, familyMembers, projectionYears, selectedYear, view } = input;
  const asOfMode: AsOfMode = input.asOfMode ?? "eoy";
  const planStartYear = projectionYears[0]?.year ?? selectedYear;

  const yearData =
    asOfMode === "today"
      ? projectionYears[0]
      : projectionYears.find((y) => y.year === selectedYear);
  if (!yearData) throw new Error(`Projection year ${selectedYear} not found`);

  const priorYear =
    asOfMode === "today" ? null : findPriorYear(projectionYears, selectedYear);

  const entitiesById = new Map(entities.map((e) => [e.id, e]));
  const familyMemberById = new Map(familyMembers.map((fm) => [fm.id, fm]));

  function ownerTypeForEntity(entityType: string): OutOfEstateOwnerType {
    if (entityType === "trust") return "trust";
    if (entityType === "foundation") return "foundation";
    if (BUSINESS_ENTITY_TYPES.has(entityType)) return "business";
    return "entity";
  }
  const ooeOwners = new Map<string, { name: string; type: OutOfEstateOwnerType; asset: number; liab: number }>();
  function ooeAdd(key: string, name: string, type: OutOfEstateOwnerType, asset: number, liab: number) {
    const cur = ooeOwners.get(key) ?? { name, type, asset: 0, liab: 0 };
    cur.asset += asset;
    cur.liab += liab;
    ooeOwners.set(key, cur);
  }
  function ooeAddEntity(entityId: string, fallbackName: string, asset: number, liab: number) {
    const e = entitiesById.get(entityId);
    ooeAdd(`en:${entityId}`, e?.name ?? fallbackName, ownerTypeForEntity(e?.entityType ?? "other"), asset, liab);
  }

  // Mortgages keyed by linked-property accountId — used for the M chip on
  // real-estate rows and for the in-estate equity calculation.
  const mortgagesByPropertyId = new Map<string, LiabilityLike[]>();
  for (const liab of liabilities) {
    if (!liab.linkedPropertyId) continue;
    const list = mortgagesByPropertyId.get(liab.linkedPropertyId) ?? [];
    list.push(liab);
    mortgagesByPropertyId.set(liab.linkedPropertyId, list);
  }

  // ── Expand each account into per-owner slices ───────────────────────────

  const slices: Slice[] = [];

  for (const acct of accounts) {
    const categoryKey = DB_TO_KEY[acct.category];
    if (!categoryKey) continue;
    const value = accountValueForYear(yearData, acct.id, asOfMode);
    // Keep entity-owned accounts even at $0 so an entity's default-cash
    // account stays visible under its entity card — consistent with the
    // entity cash flow report. Zero-value family accounts are still dropped.
    const isEntityOwned = acct.owners.some((o) => o.kind === "entity");
    if (value <= 0 && !isEntityOwned) continue;
    const hasLinkedMortgage =
      categoryKey === "realEstate" &&
      (mortgagesByPropertyId.get(acct.id)?.length ?? 0) > 0;

    // For EoY views: use the engine's locked entity/family shares (so
    // household drains on a joint account don't bleed into the entity's
    // portion). BoY / today views fall back to authored percent × value.
    const useLockedShares = asOfMode === "eoy";
    const ownerSlices = resolveOwnerSlices(
      acct.id,
      acct.owners,
      value,
      useLockedShares ? yearData.entityAccountSharesEoY : undefined,
      useLockedShares ? yearData.familyAccountSharesEoY : undefined,
    );

    for (const { owner, value: sliceValue } of ownerSlices) {
      // A $0 entity slice (e.g. an empty default-cash account) still emits a
      // row so the account is visible under its entity. Zero family slices
      // remain suppressed.
      if (owner.kind === "external_beneficiary") {
        // An external beneficiary carries no present balance-sheet value when a
        // real (family/entity) owner is on the account — that owner already holds
        // the full balance (resolveOwnerSlices gives them the residual pool).
        // Only surface external value when it would otherwise be dropped entirely
        // (e.g. an external-only account), to avoid double-counting into OOE.
        const absorbedByInEstateOwner = acct.owners.some(
          (o) => o.kind === "family_member" || o.kind === "entity",
        );
        if (view === "consolidated" && value > 0 && !absorbedByInEstateOwner) {
          ooeAdd("ext", "Other (out of estate)", "external", value * owner.percent, 0);
        }
        continue;
      }
      // Gifted-away slices have left the estate — same treatment as external_beneficiary.
      if (owner.kind === "gifted_away") {
        const absorbedByInEstateOwner = acct.owners.some(
          (o) => o.kind === "family_member" || o.kind === "entity",
        );
        if (view === "consolidated" && value > 0 && !absorbedByInEstateOwner) {
          ooeAdd("ext", "Other (out of estate)", "external", value * owner.percent, 0);
        }
        continue;
      }
      if (sliceValue <= 0 && owner.kind !== "entity") continue;
      // Derive percent from slice / account so multi-owner accounts surface
      // the projected (drifted) ownership rather than the static authored split.
      const derivedPercent = value > 0 ? sliceValue / value : owner.percent;
      const common: SliceCommon = {
        rowKey:
          owner.kind === "family_member"
            ? `${acct.id}#fm:${owner.familyMemberId}`
            : `${acct.id}#en:${owner.entityId}`,
        accountId: acct.id,
        accountName: acct.name,
        category: categoryKey,
        ownerPercent: derivedPercent,
        ownerLabel: "", // filled in below
        value: sliceValue,
        hasLinkedMortgage,
        accountHasMultipleOwners: acct.owners.length > 1,
        revocableTrustName: acct.revocableTrustName ?? null,
      };

      if (owner.kind === "family_member") {
        const fm = familyMemberById.get(owner.familyMemberId);
        const role = familyRoleLabel(fm?.role ?? "other");
        slices.push({
          ...common,
          kind: "family",
          role,
          familyMemberId: owner.familyMemberId,
          ownerLabel: ownerLabelForFamily(role, fm?.firstName),
        });
      } else {
        const entity = entitiesById.get(owner.entityId);
        if (!entity) continue;
        const klass = classifySlice(owner, entitiesById);
        const familyShare = isBusinessEntity(entity) ? familyOwnedFraction(entity) : 1;
        slices.push({
          ...common,
          kind: "entity",
          entityId: owner.entityId,
          inEstate: klass === "in_estate",
          familyShare,
          ownerLabel: entity.name,
        });
      }
    }
  }

  // ── Filter by view ───────────────────────────────────────────────────────

  // The legacy ownership-filter operates on legacy `{owner, ownerEntityId}`
  // shapes; we filter slices directly here based on their kind and role.
  const filteredSlices = slices.filter((s) => {
    if (view === "consolidated") return true;
    if (view === "entities") return s.kind === "entity";
    // client / spouse / joint
    if (s.kind !== "family") return false;
    if (view === "joint") {
      // Joint view: include slices on accounts where multiple family
      // members appear. Detected after-the-fact below.
      return true;
    }
    return s.role === view;
  });

  // For "joint" view, restrict family slices to those on accounts with
  // multi-family-member ownership.
  let viewSlices: Slice[];
  if (view === "joint") {
    const familyOwnersByAccount = new Map<string, Set<string>>();
    for (const s of slices) {
      if (s.kind !== "family") continue;
      const set = familyOwnersByAccount.get(s.accountId) ?? new Set<string>();
      set.add(s.familyMemberId);
      familyOwnersByAccount.set(s.accountId, set);
    }
    viewSlices = filteredSlices.filter(
      (s) => s.kind === "family" && (familyOwnersByAccount.get(s.accountId)?.size ?? 0) >= 2,
    );
  } else {
    viewSlices = filteredSlices;
  }

  // ── Asset categories (in-estate) ─────────────────────────────────────────

  const inEstateSlicesByCategory = new Map<AssetCategoryKey, AssetRow[]>();
  const outOfEstateRows: AssetRow[] = [];

  // Consolidated view aggregates business-entity slices into one row per
  // entity under the Business category. The row's value rolls up the
  // entity's flat valuation (in-estate share) plus its share of every
  // account it holds — so a savings account owned 80% by Cooper / 20% by
  // Smith LLC shows as Cooper $80k under Cash and as $20k folded into
  // Smith LLC's Business row, not as a separate Cash row for the LLC.
  interface BusinessAggregate {
    entityName: string;
    inEstate: number;
    outOfEstate: number;
  }
  const businessAggregates = new Map<string, BusinessAggregate>();
  function aggregateBusiness(entityId: string, entityName: string, inEstate: number, outOfEstate: number) {
    const cur = businessAggregates.get(entityId) ?? { entityName, inEstate: 0, outOfEstate: 0 };
    cur.inEstate += inEstate;
    cur.outOfEstate += outOfEstate;
    businessAggregates.set(entityId, cur);
  }

  for (const slice of viewSlices) {
    const sliceRow: AssetRow = sliceToRow(slice);

    // Entity slice that's out-of-estate (irrevocable trust, foundation, unknown
    // entity) → OOE detail row + per-owner aggregate (consolidated view only).
    if (view === "consolidated" && slice.kind === "entity" && (!slice.inEstate || slice.familyShare === 0)) {
      outOfEstateRows.push(sliceRow);
      ooeAddEntity(slice.entityId, slice.ownerLabel, slice.value, 0);
      continue;
    }

    // Consolidated view: business-entity slices aggregate into the entity's
    // Business row. Trust slices (revocable) keep their natural category.
    if (view === "consolidated" && slice.kind === "entity") {
      const entity = entitiesById.get(slice.entityId);
      if (entity && isBusinessEntity(entity)) {
        const inE = slice.value * slice.familyShare;
        const out = slice.value - inE;
        aggregateBusiness(slice.entityId, entity.name, inE, out);
        continue;
      }
      // Revocable trust slice — falls through to category routing below.
    }

    // Child / other family members are out-of-estate (consistent with attribute.ts).
    if (view === "consolidated" && slice.kind === "family") {
      const fm = familyMemberById.get(slice.familyMemberId);
      const realRole = fm?.role ?? "other";
      if (!isInEstateFamilyRole(realRole)) {
        outOfEstateRows.push(sliceRow);
        ooeAdd(`fm:${slice.familyMemberId}`, fm?.firstName ?? "Other", "person", slice.value, 0);
        continue;
      }
    }

    const list = inEstateSlicesByCategory.get(slice.category) ?? [];
    list.push(sliceRow);
    inEstateSlicesByCategory.set(slice.category, list);
  }

  // Consolidated view: collapse the per-owner slices of an account owned
  // solely by in-estate family members (e.g. a client+spouse joint account)
  // into a single household "Joint" row. This mirrors eMoney's single Joint
  // column and removes the duplicate half-value rows that the import's 50/50
  // owner synthesis would otherwise produce. Single-owner accounts and any
  // account with an entity slice are left untouched.
  if (view === "consolidated") {
    for (const [categoryKey, rows] of inEstateSlicesByCategory) {
      const byAccount = new Map<string, AssetRow[]>();
      for (const r of rows) {
        const list = byAccount.get(r.accountId) ?? [];
        list.push(r);
        byAccount.set(r.accountId, list);
      }
      const collapsed: AssetRow[] = [];
      for (const group of byAccount.values()) {
        const allFamily = group.every((r) => r.ownerEntityId === null);
        if (group.length > 1 && allFamily) {
          const first = group[0];
          collapsed.push({
            ...first,
            rowKey: first.accountId,
            owner: "joint",
            ownerLabel: "Joint",
            ownerPercent: 1,
            value: group.reduce((s, r) => s + r.value, 0),
            accountHasMultipleOwners: true,
          });
        } else {
          collapsed.push(...group);
        }
      }
      inEstateSlicesByCategory.set(categoryKey, collapsed);
    }
  }

  // ── Fold flat business-entity valuations into the same buckets ──────────

  // The flat valuation surfaces:
  //   • Consolidated view: combined with held-account slices into one row per
  //     entity under the Business category. Out-of-estate residual emits its
  //     own row in outOfEstateRows.
  //   • Entities view: one row per entity card with its full flat value.
  //   • Personal views: credited to each family member by their entity_owners
  //     share so the Business category appears in their personal totals.
  for (const e of entities) {
    if (!isBusinessEntity(e)) continue;
    const flat = flatBusinessValueAt(e.value ?? 0, e.valueGrowthRate, selectedYear, planStartYear).now;
    if (flat <= 0) continue;
    const familyShare = familyOwnedFraction(e);

    if (view === "consolidated") {
      aggregateBusiness(e.id, e.name, flat * familyShare, flat * (1 - familyShare));
    } else if (view === "entities") {
      const list = inEstateSlicesByCategory.get("business") ?? [];
      list.push({
        rowKey: `flat:${e.id}`,
        accountId: e.id,
        accountName: e.name,
        owner: null,
        ownerEntityId: e.id,
        ownerPercent: 1,
        ownerLabel: e.name,
        value: flat,
        hasLinkedMortgage: false,
        isFlatBusinessValue: true,
        accountHasMultipleOwners: false,
      });
      inEstateSlicesByCategory.set("business", list);
    } else {
      // Personal views — credit each family member with their share of the
      // flat valuation under the Business category. Entity-owners of the
      // business (e.g. a trust holding it) are excluded here; they surface
      // in the entities-view rollup instead.
      for (const fmRow of e.owners ?? []) {
        if (fmRow.kind !== "family_member") continue;
        const fm = familyMemberById.get(fmRow.familyMemberId);
        if (!fm) continue;
        const role = familyRoleLabel(fm.role);
        if (view === "joint") continue; // flat values are credited to a single role; joint has no clean home
        if (role !== view) continue;
        const sliceValue = flat * fmRow.percent;
        if (sliceValue <= 0) continue;
        const list = inEstateSlicesByCategory.get("business") ?? [];
        list.push({
          rowKey: `flat:${e.id}#fm:${fmRow.familyMemberId}`,
          accountId: e.id,
          accountName: e.name,
          owner: role,
          ownerEntityId: e.id,
          ownerPercent: fmRow.percent,
          ownerLabel: ownerLabelForFamily(role, fm.firstName),
          value: sliceValue,
          hasLinkedMortgage: false,
          isFlatBusinessValue: true,
          accountHasMultipleOwners: false,
        });
        inEstateSlicesByCategory.set("business", list);
      }
    }
  }

  // ── Emit one Business row per aggregated business entity (consolidated) ─

  if (view === "consolidated") {
    for (const [entityId, agg] of businessAggregates) {
      if (agg.inEstate > 0) {
        const list = inEstateSlicesByCategory.get("business") ?? [];
        list.push({
          rowKey: `biz:${entityId}@in`,
          accountId: entityId,
          accountName: agg.entityName,
          owner: null,
          ownerEntityId: entityId,
          ownerPercent: 1,
          ownerLabel: agg.entityName,
          value: agg.inEstate,
          hasLinkedMortgage: false,
          // Aggregated row represents the business interest as a whole, not
          // just the standalone flat valuation. The panel uses this flag to
          // suppress the redundant entity-name chip on the row.
          isFlatBusinessValue: true,
          accountHasMultipleOwners: false,
        });
        inEstateSlicesByCategory.set("business", list);
      }
      if (agg.outOfEstate > 0) {
        outOfEstateRows.push({
          rowKey: `biz:${entityId}@oo`,
          accountId: entityId,
          accountName: agg.entityName,
          owner: null,
          ownerEntityId: entityId,
          ownerPercent: 1,
          ownerLabel: agg.entityName,
          value: agg.outOfEstate,
          hasLinkedMortgage: false,
          isFlatBusinessValue: true,
          accountHasMultipleOwners: false,
        });
        ooeAdd(`en:${entityId}`, agg.entityName, "business", agg.outOfEstate, 0);
      }
    }
  }

  // ── Build asset categories with subtotals + YoY ─────────────────────────

  const assetCategories: AssetCategoryGroup[] = [];
  for (const categoryKey of CATEGORY_ORDER) {
    const rows = inEstateSlicesByCategory.get(categoryKey) ?? [];
    if (rows.length === 0) continue;
    const total = rows.reduce((s, r) => s + r.value, 0);
    const priorTotal = priorYear ? sumCategoryForYear(input, priorYear, categoryKey) : null;
    assetCategories.push({
      key: categoryKey,
      label: CATEGORY_LABELS[categoryKey],
      total,
      rows,
      yoy: yoyPct(total, priorTotal),
    });
  }

  // ── Liabilities: same slice expansion ───────────────────────────────────

  const liabilitySlices: Array<
    | { kind: "family"; rowKey: string; familyMemberId: string; rawRole: "client" | "spouse" | "child" | "other"; firstName?: string; row: LiabilityRow }
    | { kind: "entity"; rowKey: string; row: LiabilityRow; inEstate: boolean; entityId: string; familyShare: number }
  > = [];

  for (const liab of liabilities) {
    const balance = yearData.liabilityBalancesBoY[liab.id] ?? 0;
    if (balance <= 0) continue;
    for (const owner of liab.owners) {
      const sliceBalance = balance * owner.percent;
      if (sliceBalance <= 0) continue;
      if (owner.kind === "external_beneficiary") {
        if (view === "consolidated") ooeAdd("ext", "Other (out of estate)", "external", 0, sliceBalance);
        continue;
      }
      // Gifted-away slices have left the estate — same as external_beneficiary.
      if (owner.kind === "gifted_away") {
        if (view === "consolidated") ooeAdd("ext", "Other (out of estate)", "external", 0, sliceBalance);
        continue;
      }
      if (owner.kind === "family_member") {
        const fm = familyMemberById.get(owner.familyMemberId);
        const role = familyRoleLabel(fm?.role ?? "other");
        liabilitySlices.push({
          kind: "family",
          rowKey: `${liab.id}#fm:${owner.familyMemberId}`,
          familyMemberId: owner.familyMemberId,
          rawRole: fm?.role ?? "other",
          firstName: fm?.firstName,
          row: {
            rowKey: `${liab.id}#fm:${owner.familyMemberId}`,
            liabilityId: liab.id,
            liabilityName: liab.name,
            owner: role,
            ownerEntityId: null,
            ownerPercent: owner.percent,
            ownerLabel: ownerLabelForFamily(role, fm?.firstName),
            balance: sliceBalance,
          },
        });
      } else {
        const entity = entitiesById.get(owner.entityId);
        if (!entity) continue;
        const klass = classifySlice(owner, entitiesById);
        const familyShare = isBusinessEntity(entity) ? familyOwnedFraction(entity) : 1;
        liabilitySlices.push({
          kind: "entity",
          rowKey: `${liab.id}#en:${owner.entityId}`,
          inEstate: klass === "in_estate",
          entityId: owner.entityId,
          familyShare,
          row: {
            rowKey: `${liab.id}#en:${owner.entityId}`,
            liabilityId: liab.id,
            liabilityName: liab.name,
            owner: null,
            ownerEntityId: owner.entityId,
            ownerPercent: owner.percent,
            ownerLabel: entity.name,
            balance: sliceBalance,
          },
        });
      }
    }
  }

  let liabilityRows: LiabilityRow[];
  let outOfEstateLiabilityRows: LiabilityRow[];
  if (view === "consolidated") {
    liabilityRows = [];
    outOfEstateLiabilityRows = [];
    for (const ls of liabilitySlices) {
      if (ls.kind === "family") {
        if (!isInEstateFamilyRole(ls.rawRole)) {
          outOfEstateLiabilityRows.push(ls.row);
          ooeAdd(`fm:${ls.familyMemberId}`, ls.firstName ?? "Other", "person", 0, ls.row.balance);
        } else {
          liabilityRows.push(ls.row);
        }
        continue;
      }
      // Entity liability: family share → in-estate, residual → OOE.
      if (!ls.inEstate || ls.familyShare === 0) {
        outOfEstateLiabilityRows.push(ls.row);
        ooeAddEntity(ls.entityId, ls.row.ownerLabel, 0, ls.row.balance);
        continue;
      }
      if (ls.familyShare < 1) {
        const familyVal = ls.row.balance * ls.familyShare;
        const residual = ls.row.balance - familyVal;
        liabilityRows.push({ ...ls.row, rowKey: `${ls.row.rowKey}@in`, balance: familyVal });
        outOfEstateLiabilityRows.push({ ...ls.row, rowKey: `${ls.row.rowKey}@oo`, balance: residual });
        ooeAddEntity(ls.entityId, ls.row.ownerLabel, 0, residual);
      } else {
        liabilityRows.push(ls.row);
      }
    }
  } else if (view === "entities") {
    // Entity-owned liabilities only; family-owned liabilities are out of view.
    liabilityRows = liabilitySlices.filter((s) => s.kind === "entity").map((s) => s.row);
    outOfEstateLiabilityRows = [];
  } else {
    // Personal views: only family-owned liabilities matching the role.
    liabilityRows = liabilitySlices
      .filter((s) => s.kind === "family")
      .map((s) => s.row)
      .filter((r) => {
        if (view === "joint") {
          return false; // Joint liabilities require multi-owner detection; rare on liabilities — skip for simplicity.
        }
        return r.owner === view;
      });
    outOfEstateLiabilityRows = [];
  }

  // ── Joint view: include accounts/liabs with multi-family ownership ──────

  if (view === "joint") {
    // Collapse family slices on multi-owner accounts into a single combined
    // row showing the household total for that account.
    const combined = new Map<string, AssetRow>();
    for (const cat of assetCategories) {
      for (const row of cat.rows) {
        const existing = combined.get(row.accountId);
        if (existing) {
          existing.value += row.value;
        } else {
          combined.set(row.accountId, { ...row, rowKey: row.accountId, value: row.value, owner: "joint", ownerLabel: "Joint", ownerPercent: 1 });
        }
      }
    }
    // Rebuild assetCategories with combined rows.
    const grouped = new Map<AssetCategoryKey, AssetRow[]>();
    for (const row of combined.values()) {
      const cat = (CATEGORY_ORDER as AssetCategoryKey[]).find((c) =>
        assetCategories.find((g) => g.key === c)?.rows.some((r) => r.accountId === row.accountId),
      );
      if (!cat) continue;
      const list = grouped.get(cat) ?? [];
      list.push(row);
      grouped.set(cat, list);
    }
    assetCategories.length = 0;
    for (const categoryKey of CATEGORY_ORDER) {
      const rows = grouped.get(categoryKey) ?? [];
      if (rows.length === 0) continue;
      const total = rows.reduce((s, r) => s + r.value, 0);
      assetCategories.push({
        key: categoryKey,
        label: CATEGORY_LABELS[categoryKey],
        total,
        rows,
        yoy: null,
      });
    }
  }

  // ── Entity groups (entities view) ───────────────────────────────────────

  let entityGroups: EntityGroup[] | undefined;
  if (view === "entities") {
    // Each top-level business account (category="business", no parent) and its
    // parentAccountId subtree gets its own business card below. Resolve the
    // subtrees once, up front: reused both to exclude those accounts from the
    // trust/entity cards (so a trust-owned business doesn't also show as a
    // rolled-up row under the trust) and to build the business cards.
    const businessTrees = accounts
      .filter((a) => a.category === "business" && a.parentAccountId == null)
      .map((b) => ({ root: b, tree: collectBusinessTree(b.id, accounts) }));
    const businessTreeAccountIds = new Set(
      businessTrees.flatMap(({ tree }) => tree.map((a) => a.id)),
    );

    const allAssetRows = assetCategories.flatMap((c) => c.rows);
    const assetsByEntity = new Map<string, AssetRow[]>();
    for (const row of allAssetRows) {
      if (!row.ownerEntityId) continue;
      if (businessTreeAccountIds.has(row.accountId)) continue;
      const list = assetsByEntity.get(row.ownerEntityId) ?? [];
      list.push(row);
      assetsByEntity.set(row.ownerEntityId, list);
    }
    const liabsByEntity = new Map<string, LiabilityRow[]>();
    for (const row of liabilityRows) {
      if (!row.ownerEntityId) continue;
      const list = liabsByEntity.get(row.ownerEntityId) ?? [];
      list.push(row);
      liabsByEntity.set(row.ownerEntityId, list);
    }

    const makeGroup = (
      entityId: string,
      entityName: string,
      entityType: string,
      assetRows: AssetRow[],
      liabilityRows: LiabilityRow[],
    ): EntityGroup => {
      const assetTotal = assetRows.reduce((s, r) => s + r.value, 0);
      const liabilityTotal = liabilityRows.reduce((s, r) => s + r.balance, 0);
      return { entityId, entityName, entityType, assetRows, assetTotal, liabilityRows, liabilityTotal, netWorth: assetTotal - liabilityTotal };
    };

    const trustGroups = entities
      .map((e) => makeGroup(e.id, e.name, e.entityType, assetsByEntity.get(e.id) ?? [], liabsByEntity.get(e.id) ?? []))
      .filter((g) => g.assetRows.length > 0 || g.liabilityRows.length > 0);

    // Business-as-asset groups: one card per business with its own value plus
    // its parentAccountId sub-accounts as nested rows and its sub-liabilities
    // netted out. Ownership is irrelevant here — a business gets its own card
    // whether it's family- or trust-owned.
    const businessGroups: EntityGroup[] = [];
    for (const { root: b, tree } of businessTrees) {
      const treeIds = new Set(tree.map((a) => a.id));
      const assetRows: AssetRow[] = tree.map((acct) => ({
        rowKey: acct.id === b.id ? `biz:${acct.id}` : `bizchild:${acct.id}`,
        accountId: acct.id,
        accountName: acct.name,
        owner: null,
        ownerEntityId: b.id,
        ownerPercent: 1,
        ownerLabel: acct.name,
        value: accountValueForYear(yearData, acct.id, asOfMode),
        hasLinkedMortgage: false,
        isFlatBusinessValue: false,
        accountHasMultipleOwners: false,
      }));
      const bizLiabRows: LiabilityRow[] = [];
      for (const l of liabilities) {
        if (l.parentAccountId == null || !treeIds.has(l.parentAccountId)) continue;
        const balance = yearData.liabilityBalancesBoY[l.id] ?? 0;
        if (balance <= 0) continue;
        bizLiabRows.push({
          rowKey: `bizliab:${l.id}`,
          liabilityId: l.id,
          liabilityName: l.name,
          owner: null,
          ownerEntityId: b.id,
          ownerPercent: 1,
          ownerLabel: l.name,
          balance,
        });
      }
      const group = makeGroup(b.id, b.name, b.businessType ?? "other", assetRows, bizLiabRows);
      // Skip a wholly empty business (no value anywhere, no debt).
      if (group.assetTotal === 0 && group.liabilityTotal === 0) continue;
      businessGroups.push(group);
    }

    entityGroups = [...trustGroups, ...businessGroups];
  }

  // ── Totals ──────────────────────────────────────────────────────────────

  const totalAssets = assetCategories.reduce((sum, c) => sum + c.total, 0);
  const totalLiabilities = liabilityRows.reduce((sum, r) => sum + r.balance, 0);
  const netWorth = totalAssets - totalLiabilities;

  const outOfEstateOwnerRows: OutOfEstateOwnerRow[] =
    view === "consolidated"
      ? [...ooeOwners.entries()]
          .map(([ownerKey, o]) => ({
            ownerKey,
            ownerName: o.name,
            ownerType: o.type,
            assetTotal: o.asset,
            liabilityTotal: o.liab,
            net: o.asset - o.liab,
          }))
          .sort((a, b) => b.net - a.net)
      : [];
  const outOfEstateNetWorth = outOfEstateOwnerRows.reduce((s, r) => s + r.net, 0);

  // ── Real estate equity (in-estate real estate − linked mortgages) ───────

  const realEstateCategory = assetCategories.find((c) => c.key === "realEstate");
  const realEstateMarketValue = realEstateCategory?.rows.reduce((sum, r) => sum + r.value, 0) ?? 0;
  const inEstateRealEstateAccountIds = new Set(
    (realEstateCategory?.rows ?? []).map((r) => r.accountId),
  );
  const linkedMortgageBalance = liabilityRows
    .filter((r) => {
      // Find the underlying liability and check if it links to an
      // in-estate real-estate row. We don't have linkedPropertyId on
      // LiabilityRow, so re-resolve from the input liabilities array.
      const liab = liabilities.find((l) => l.id === r.liabilityId);
      return (
        liab?.linkedPropertyId != null &&
        inEstateRealEstateAccountIds.has(liab.linkedPropertyId)
      );
    })
    .reduce((sum, r) => sum + r.balance, 0);
  const realEstateEquity = realEstateMarketValue - linkedMortgageBalance;

  // ── Donut ───────────────────────────────────────────────────────────────

  const donut: DonutSlice[] = [];
  for (const cat of assetCategories) {
    if (cat.total <= 0) continue;
    donut.push({
      key: cat.key,
      label: cat.label,
      value: cat.total,
      hex: CATEGORY_HEX[cat.key],
    });
  }

  // ── Bar chart ───────────────────────────────────────────────────────────

  const allYears = projectionYears.map((y) => y.year);
  const windowAnchor = asOfMode === "today" ? projectionYears[0].year : selectedYear;
  const windowYears = sliceBarAnchors(allYears, windowAnchor);
  const barChartSeries: BarChartPoint[] = windowYears.map((yr) => {
    const yData = projectionYears.find((y) => y.year === yr)!;
    return {
      year: yr,
      assets: sumInEstateAssetsForYear(input, yData),
      liabilities: sumInEstateLiabilitiesForYear(input, yData),
    };
  });

  // ── YoY ─────────────────────────────────────────────────────────────────

  const priorTotalAssets = priorYear ? sumInEstateAssetsForYear(input, priorYear) : null;
  const priorTotalLiabilities = priorYear ? sumInEstateLiabilitiesForYear(input, priorYear) : null;
  const priorNetWorth =
    priorTotalAssets != null && priorTotalLiabilities != null
      ? priorTotalAssets - priorTotalLiabilities
      : null;

  return {
    selectedYear,
    assetCategories,
    outOfEstateRows,
    outOfEstateLiabilityRows,
    outOfEstateNetWorth,
    outOfEstateOwnerRows,
    liabilityRows,
    entityGroups,
    totalAssets,
    totalLiabilities,
    netWorth,
    realEstateEquity,
    donut,
    barChartSeries,
    yoy: {
      totalAssets: yoyPct(totalAssets, priorTotalAssets),
      totalLiabilities: yoyPct(totalLiabilities, priorTotalLiabilities),
      netWorth: yoyPct(netWorth, priorNetWorth),
    },
  };
}

// ── Slice → AssetRow conversion ──────────────────────────────────────────────

function sliceToRow(slice: Slice): AssetRow {
  if (slice.kind === "family") {
    return {
      rowKey: slice.rowKey,
      accountId: slice.accountId,
      accountName: slice.accountName,
      owner: slice.role,
      ownerEntityId: null,
      ownerPercent: slice.ownerPercent,
      ownerLabel: slice.ownerLabel,
      value: slice.value,
      hasLinkedMortgage: slice.hasLinkedMortgage,
      isFlatBusinessValue: false,
      accountHasMultipleOwners: slice.accountHasMultipleOwners,
      revocableTrustName: slice.revocableTrustName ?? null,
    };
  }
  return {
    rowKey: slice.rowKey,
    accountId: slice.accountId,
    accountName: slice.accountName,
    owner: null,
    ownerEntityId: slice.entityId,
    ownerPercent: slice.ownerPercent,
    ownerLabel: slice.ownerLabel,
    value: slice.value,
    hasLinkedMortgage: slice.hasLinkedMortgage,
    isFlatBusinessValue: false,
    accountHasMultipleOwners: slice.accountHasMultipleOwners,
    revocableTrustName: slice.revocableTrustName ?? null,
  };
}

// ── Bar-chart / YoY helpers (recompute totals against arbitrary years) ──────

interface YearTotals {
  totalAssets: number;
  totalLiabilities: number;
  byCategory: Map<AssetCategoryKey, number>;
}

/** Pure totals computation — no YoY, no bar chart, no recursion. Mirrors
 *  the slice-classification logic in the main builder for the consolidated
 *  view (the only view that drives YoY/bar). */
function computeYearTotals(
  input: BuildViewModelInput,
  yearData: ProjectionYearLike,
): YearTotals {
  const { accounts, liabilities, entities, familyMembers, projectionYears, selectedYear } = input;
  const planStartYear = projectionYears[0]?.year ?? selectedYear;
  const entitiesById = new Map(entities.map((e) => [e.id, e]));
  const familyMemberById = new Map(familyMembers.map((fm) => [fm.id, fm]));

  const byCategory = new Map<AssetCategoryKey, number>();
  let totalLiabilities = 0;

  for (const acct of accounts) {
    const categoryKey = DB_TO_KEY[acct.category];
    if (!categoryKey) continue;
    const ledger = yearData.accountLedgers[acct.id];
    if (!ledger) continue;
    const value = ledger.endingValue;
    if (value <= 0) continue;
    const ownerSlices = resolveOwnerSlices(
      acct.id,
      acct.owners,
      value,
      yearData.entityAccountSharesEoY,
      yearData.familyAccountSharesEoY,
    );
    for (const { owner, value: sliceValue } of ownerSlices) {
      if (sliceValue <= 0) continue;
      let inEstateValue = 0;
      if (owner.kind === "family_member") {
        const fm = familyMemberById.get(owner.familyMemberId);
        const role = fm?.role ?? "other";
        if (isInEstateFamilyRole(role)) inEstateValue = sliceValue;
      } else if (owner.kind === "entity") {
        const e = entitiesById.get(owner.entityId);
        if (!e) continue;
        if (e.entityType === "trust") {
          if (!e.isIrrevocable) inEstateValue = sliceValue;
        } else if (isBusinessEntity(e)) {
          inEstateValue = sliceValue * familyOwnedFraction(e);
        }
      }
      if (inEstateValue > 0) {
        byCategory.set(categoryKey, (byCategory.get(categoryKey) ?? 0) + inEstateValue);
      }
    }
  }

  for (const e of entities) {
    if (!isBusinessEntity(e)) continue;
    const flat = flatBusinessValueAt(e.value ?? 0, e.valueGrowthRate, yearData.year, planStartYear).now;
    if (flat <= 0) continue;
    const inEstate = flat * familyOwnedFraction(e);
    if (inEstate > 0) {
      byCategory.set("business", (byCategory.get("business") ?? 0) + inEstate);
    }
  }

  for (const liab of liabilities) {
    const balance = yearData.liabilityBalancesBoY[liab.id] ?? 0;
    if (balance <= 0) continue;
    for (const owner of liab.owners) {
      const sliceBalance = balance * owner.percent;
      if (sliceBalance <= 0) continue;
      let inEstateBalance = 0;
      if (owner.kind === "family_member") {
        const fm = familyMemberById.get(owner.familyMemberId);
        const role = fm?.role ?? "other";
        if (isInEstateFamilyRole(role)) inEstateBalance = sliceBalance;
      } else if (owner.kind === "entity") {
        const e = entitiesById.get(owner.entityId);
        if (!e) continue;
        if (e.entityType === "trust") {
          if (!e.isIrrevocable) inEstateBalance = sliceBalance;
        } else if (isBusinessEntity(e)) {
          inEstateBalance = sliceBalance * familyOwnedFraction(e);
        }
      }
      totalLiabilities += inEstateBalance;
    }
  }

  let totalAssets = 0;
  for (const v of byCategory.values()) totalAssets += v;
  return { totalAssets, totalLiabilities, byCategory };
}

function sumInEstateAssetsForYear(
  input: BuildViewModelInput,
  yearData: ProjectionYearLike,
): number {
  return computeYearTotals(input, yearData).totalAssets;
}

function sumInEstateLiabilitiesForYear(
  input: BuildViewModelInput,
  yearData: ProjectionYearLike,
): number {
  return computeYearTotals(input, yearData).totalLiabilities;
}

function sumCategoryForYear(
  input: BuildViewModelInput,
  yearData: ProjectionYearLike,
  category: AssetCategoryKey,
): number {
  return computeYearTotals(input, yearData).byCategory.get(category) ?? 0;
}

