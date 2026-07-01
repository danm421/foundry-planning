// src/components/balance-sheet-report/household-columns.ts
import {
  attributeToColumns,
  attributeEntityFlatValue,
  type AttributionCtx,
} from "@/lib/balance-sheet/attribute";
import { flatBusinessValueAt } from "@/engine/entity-cashflow";
import type { FamilyMember } from "@/engine/types";
import type { AccountLike, LiabilityLike, EntityInfo, AsOfMode } from "./view-model";
import type { NoteLike } from "@/lib/balance-sheet/build-view-model-inputs";
import { CATEGORY_LABELS, CATEGORY_ORDER, type AssetCategoryKey } from "./tokens";

const BUSINESS_ENTITY_TYPES = new Set(["llc", "s_corp", "c_corp", "partnership", "other"]);

/** DB account.category → tokens category key. */
const DB_TO_KEY: Record<string, AssetCategoryKey> = {
  cash: "cash",
  taxable: "taxable",
  retirement: "retirement",
  real_estate: "realEstate",
  business: "business",
  stock_options: "stockOptions",
  life_insurance: "lifeInsurance",
};

/** Household category keys: the six asset categories + notes receivable. */
export type HouseholdCategoryKey = AssetCategoryKey | "notesReceivable";

export const HOUSEHOLD_CATEGORY_ORDER: HouseholdCategoryKey[] = [
  ...CATEGORY_ORDER,
  "notesReceivable",
];
export const HOUSEHOLD_CATEGORY_LABELS: Record<HouseholdCategoryKey, string> = {
  ...CATEGORY_LABELS,
  notesReceivable: "Notes Receivable",
};

export interface OwnerColumns {
  client: number;
  spouse: number;
  joint: number;
  total: number; // client + spouse + joint (in-estate portion only)
}

export interface OwnerColumnRow extends OwnerColumns {
  key: string;
  name: string;
  hasLinkedMortgage: boolean;
  revocableTrustName?: string | null;
}

export interface OwnerColumnCategory extends OwnerColumns {
  key: HouseholdCategoryKey;
  label: string;
  rows: OwnerColumnRow[];
}

export interface HouseholdColumnsModel {
  selectedYear: number;
  hasSpouse: boolean;
  assetCategories: OwnerColumnCategory[];
  liabilityRows: OwnerColumnRow[];
  totalAssets: OwnerColumns;
  totalLiabilities: OwnerColumns;
  netWorth: OwnerColumns;
}

export interface HouseholdProjYear {
  year: number;
  accountLedgers: Record<string, { endingValue: number; beginningValue: number }>;
  liabilityBalancesBoY: Record<string, number>;
  notesReceivableByNote?: Record<string, { endingBalance: number }>;
}

/** Account input variant that carries titlingType (drives the Joint rule). */
export interface HouseholdAccountLike extends AccountLike {
  titlingType?: "jtwros" | "community_property" | null;
}

export interface BuildHouseholdColumnsInput {
  accounts: HouseholdAccountLike[];
  liabilities: LiabilityLike[];
  entities: EntityInfo[];
  notesReceivable: NoteLike[];
  familyMembers: FamilyMember[];
  projectionYears: HouseholdProjYear[];
  selectedYear: number;
  /** "today" = beginning-of-year balances for the first projection year
   *  (the advisor-entered current values). "eoy" = end-of-year balances for
   *  the selected year. Default: "eoy". */
  asOfMode?: AsOfMode;
}

function buildCtx(
  familyMembers: FamilyMember[],
  entities: EntityInfo[],
): AttributionCtx {
  const rolesByFamilyMemberId = new Map<string, "client" | "spouse" | "child" | "other">();
  let clientFamilyMemberId: string | null = null;
  let spouseFamilyMemberId: string | null = null;
  for (const fm of familyMembers) {
    rolesByFamilyMemberId.set(fm.id, fm.role);
    if (fm.role === "client") clientFamilyMemberId = fm.id;
    if (fm.role === "spouse") spouseFamilyMemberId = fm.id;
  }

  const inEstateFlatValuedEntityIds = new Set<string>();
  for (const e of entities) {
    if (!e.entityType || !BUSINESS_ENTITY_TYPES.has(e.entityType)) continue;
    if (e.owners == null) {
      inEstateFlatValuedEntityIds.add(e.id);
      continue;
    }
    const sum = e.owners.reduce((s, o) => s + (o.percent ?? 0), 0);
    if (sum >= 0.9999) inEstateFlatValuedEntityIds.add(e.id);
  }

  const titlingByItemId = new Map<string, "jtwros" | "community_property" | null>();
  // NOTE: AccountLike doesn't carry titlingType; populated by the caller-side
  // builder below via the raw accounts. See buildHouseholdColumns.
  return {
    clientFamilyMemberId,
    spouseFamilyMemberId,
    rolesByFamilyMemberId,
    inEstateFlatValuedEntityIds,
    titlingByItemId,
  };
}

export { buildCtx, BUSINESS_ENTITY_TYPES, DB_TO_KEY };

const ZERO: OwnerColumns = { client: 0, spouse: 0, joint: 0, total: 0 };

function addColumns(a: OwnerColumns, b: OwnerColumns): OwnerColumns {
  return {
    client: a.client + b.client,
    spouse: a.spouse + b.spouse,
    joint: a.joint + b.joint,
    total: a.total + b.total,
  };
}

/** ColumnSplit (cooper/sarah/joint) → in-estate OwnerColumns. `ooe` is
 *  dropped: out-of-estate dollars live in the separate OOE table. */
function splitToColumns(split: { cooper: number; sarah: number; joint: number }): OwnerColumns {
  const total = split.cooper + split.sarah + split.joint;
  return { client: split.cooper, spouse: split.sarah, joint: split.joint, total };
}

export function buildHouseholdColumns(input: BuildHouseholdColumnsInput): HouseholdColumnsModel {
  const { accounts, liabilities, entities, notesReceivable, familyMembers, projectionYears, selectedYear } = input;
  const asOfMode: AsOfMode = input.asOfMode ?? "eoy";
  const planStartYear = projectionYears[0]?.year ?? selectedYear;
  const yearData =
    asOfMode === "today"
      ? projectionYears[0]
      : projectionYears.find((y) => y.year === selectedYear);
  if (!yearData) throw new Error(`Projection year ${selectedYear} not found`);
  // "Today" reads beginning-of-year values of the first projection year and
  // anchors flat business valuations (and the model's reported year) to plan
  // start. "eoy" reads end-of-year values of the selected year.
  const valuationYear = asOfMode === "today" ? planStartYear : selectedYear;

  const ctx = buildCtx(familyMembers, entities);
  for (const a of accounts) {
    if (a.titlingType) ctx.titlingByItemId.set(a.id, a.titlingType);
  }
  const hasSpouse = familyMembers.some((fm) => fm.role === "spouse");

  const linkedPropertyIds = new Set(
    liabilities.map((l) => l.linkedPropertyId).filter((id): id is string => !!id),
  );

  // ── Asset rows by category ────────────────────────────────────────────────
  const rowsByCategory = new Map<HouseholdCategoryKey, OwnerColumnRow[]>();
  function pushRow(cat: HouseholdCategoryKey, row: OwnerColumnRow) {
    const list = rowsByCategory.get(cat) ?? [];
    list.push(row);
    rowsByCategory.set(cat, list);
  }

  for (const acct of accounts) {
    const cat = DB_TO_KEY[acct.category];
    if (!cat) continue;
    const ledger = yearData.accountLedgers[acct.id];
    const value = (asOfMode === "today" ? ledger?.beginningValue : ledger?.endingValue) ?? 0;
    if (value <= 0) continue;
    const cols = splitToColumns(attributeToColumns({ id: acct.id, value, owners: acct.owners }, ctx));
    if (cols.total <= 0) continue; // entirely OOE / held back
    pushRow(cat, {
      key: acct.id,
      name: acct.name,
      hasLinkedMortgage: cat === "realEstate" && linkedPropertyIds.has(acct.id),
      revocableTrustName: acct.revocableTrustName ?? null,
      ...cols,
    });
  }

  // Family-owned flat-valued businesses → one Business row each.
  for (const e of entities) {
    if (!ctx.inEstateFlatValuedEntityIds.has(e.id)) continue;
    const flatCalc = flatBusinessValueAt(e.value ?? 0, e.valueGrowthRate, valuationYear, planStartYear);
    // "Today" = beginning-of-year (prior) value at plan start; "eoy" = end-of-year (now).
    const flat = asOfMode === "today" ? flatCalc.prior : flatCalc.now;
    if (flat <= 0) continue;
    const familyOwners = (e.owners ?? [])
      .filter((o) => o.kind === "family_member")
      .map((o) => ({ familyMemberId: o.familyMemberId, percent: o.percent }));
    // A business with explicit owners but no family-member share belongs to the
    // owning entity (shown in the By-Entity tab), not the household table.
    if (e.owners != null && familyOwners.length === 0) continue;
    const cols = splitToColumns(
      attributeEntityFlatValue({ id: e.id, value: flat, owners: familyOwners.length ? familyOwners : undefined }, ctx),
    );
    if (cols.total <= 0) continue;
    pushRow("business", { key: `flat:${e.id}`, name: e.name, hasLinkedMortgage: false, ...cols });
  }

  // Notes receivable.
  for (const note of notesReceivable) {
    const value = yearData.notesReceivableByNote?.[note.id]?.endingBalance ?? 0;
    if (value <= 0) continue;
    const cols = splitToColumns(attributeToColumns({ id: note.id, value, owners: note.owners }, ctx));
    if (cols.total <= 0) continue;
    pushRow("notesReceivable", { key: note.id, name: note.name, hasLinkedMortgage: false, ...cols });
  }

  const assetCategories: OwnerColumnCategory[] = [];
  for (const key of HOUSEHOLD_CATEGORY_ORDER) {
    const rows = rowsByCategory.get(key);
    if (!rows || rows.length === 0) continue;
    const subtotal = rows.reduce(addColumns, ZERO);
    assetCategories.push({ key, label: HOUSEHOLD_CATEGORY_LABELS[key], rows, ...subtotal });
  }

  // ── Liabilities ─────────────────────────────────────────────────────────
  const liabilityRows: OwnerColumnRow[] = [];
  for (const liab of liabilities) {
    const balance = yearData.liabilityBalancesBoY[liab.id] ?? 0;
    if (balance <= 0) continue;
    const cols = splitToColumns(attributeToColumns({ id: liab.id, value: balance, owners: liab.owners }, ctx));
    if (cols.total <= 0) continue; // entity-owned liability → not in household table
    liabilityRows.push({ key: liab.id, name: liab.name, hasLinkedMortgage: false, ...cols });
  }

  const totalAssets = assetCategories.reduce<OwnerColumns>((acc, c) => addColumns(acc, c), ZERO);
  const totalLiabilities = liabilityRows.reduce<OwnerColumns>((acc, r) => addColumns(acc, r), ZERO);
  const netWorth: OwnerColumns = {
    client: totalAssets.client - totalLiabilities.client,
    spouse: totalAssets.spouse - totalLiabilities.spouse,
    joint: totalAssets.joint - totalLiabilities.joint,
    total: totalAssets.total - totalLiabilities.total,
  };

  return { selectedYear: valuationYear, hasSpouse, assetCategories, liabilityRows, totalAssets, totalLiabilities, netWorth };
}
