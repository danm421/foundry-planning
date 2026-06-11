"use client";

import { useRef, useState, useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useScenarioWriter } from "@/hooks/use-scenario-writer";
import { useScenarioPreservingHref } from "@/hooks/use-scenario-preserving-href";
import AddAccountDialog from "./add-account-dialog";
import BusinessDialog from "./business-dialog";
import type { BusinessAccount } from "./business-dialog/types";
import AddLiabilityDialog from "./add-liability-dialog";
import ConfirmDeleteDialog from "./confirm-delete-dialog";
import AccountDeleteDialog from "./account-delete-dialog";
import { AccountFormInitial, EntityOption, CategoryDefaults, ModelPortfolioOption } from "./forms/add-account-form";
import type { FundPortfolioOption } from "@/lib/investments/load-fund-portfolio-options";
import { type AssetClassOption } from "./forms/asset-mix-tab";
import { LiabilityFormInitial } from "./forms/add-liability-form";
import type { NoteReceivableFormInitial } from "./forms/add-note-receivable-form";
import { computeAmortizationSchedule, calcOriginalBalance } from "@/lib/loan-math";
import { individualOwnerLabel, type OwnerNames } from "@/lib/owner-labels";
import type { ClientMilestones } from "@/lib/milestones";
import type { AccountOwner } from "@/engine/ownership";
import {
  buildNoteReceivableSchedule,
  type NoteReceivable,
} from "@/engine/notes-receivable";
import { useToast } from "@/components/toast";
import { refreshClientHoldingPrices } from "@/lib/investments/holdings-client";

type AccountCategory = "taxable" | "cash" | "retirement" | "annuity" | "real_estate" | "business" | "life_insurance" | "notes_receivable" | "stock_options";

export interface AccountRow {
  id: string;
  name: string;
  category: AccountCategory;
  subType: string;
  owner: string;
  value: string;
  basis: string;
  rothValue?: string | null;
  /** HSA coverage tier (self/family). Hydrated from `accounts.hsa_coverage`
   * so the edit form round-trips the value instead of silently defaulting to
   * "self" (which would overwrite a persisted "family" on the next save). */
  hsaCoverage?: "self" | "family" | null;
  growthRate: string | null;
  rmdEnabled?: boolean | null;
  priorYearEndValue?: string | null;
  ownerEntityId?: string | null;
  growthSource?: string;
  modelPortfolioId?: string | null;
  tickerPortfolioId?: string | null;
  turnoverPct?: string | null;
  overridePctOi?: string | null;
  overridePctLtCg?: string | null;
  overridePctQdiv?: string | null;
  overridePctTaxExempt?: string | null;
  annualPropertyTax?: string | null;
  propertyTaxGrowthRate?: string | null;
  propertyTaxGrowthSource?: string;
  isDefaultChecking?: boolean;
  owners?: AccountOwner[];
  /** Joint-titling regime. Drives §1014(b)(6) full step-up vs §2040(b) 50/50.
   * Hydrated from `accounts.titling_type` so the edit form round-trips the
   * value instead of silently defaulting to "jtwros". */
  titlingType?: "jtwros" | "community_property";
  /** Parent business account id when this account is a sub-asset of a
   *  top-level business. Null for top-level accounts. */
  parentAccountId?: string | null;
}

export interface LiabilityRow {
  id: string;
  name: string;
  balance: string;
  interestRate: string;
  monthlyPayment: string;
  startYear: number;
  startMonth: number;
  termMonths: number;
  termUnit: string;
  balanceAsOfMonth?: number | null;
  balanceAsOfYear?: number | null;
  linkedPropertyId?: string | null;
  ownerEntityId?: string | null;
  isInterestDeductible?: boolean;
  owners?: AccountOwner[];
  /** Parent business account id when this liability hangs off a business
   *  (e.g. an LLC's mortgage). Null for household liabilities. */
  parentAccountId?: string | null;
}

interface BalanceSheetViewProps {
  clientId: string;
  accounts: AccountRow[];
  liabilities: LiabilityRow[];
  notesReceivable?: NoteReceivable[];
  /** Incomes attached to business accounts, used to render the "Incomes"
   *  pill inside an expanded business row. Only rows with ownerAccountId
   *  pointing at a business shown here are surfaced. The optional schedule
   *  fields (startYear/endYear/growthRate/inflationStartYear) drive the
   *  Custom-schedule placeholder math in BusinessFlowsTab. */
  incomes?: {
    id: string;
    name: string;
    annualAmount: number | string;
    ownerAccountId?: string | null;
    startYear?: number | null;
    endYear?: number | null;
    growthRate?: number | null;
    inflationStartYear?: number | null;
  }[];
  /** Expenses attached to business accounts, shown in the BusinessFlowsTab. */
  expenses?: {
    id: string;
    name: string;
    annualAmount: number | string;
    ownerAccountId?: string | null;
    startYear?: number | null;
    endYear?: number | null;
    growthRate?: number | null;
    inflationStartYear?: number | null;
  }[];
  /** Schedule-grid context for the Flows tab on the BusinessDialog. */
  planStartYear?: number;
  planEndYear?: number;
  primaryClientBirthYear?: number;
  entities: EntityOption[];
  familyMembers?: { id: string; role: "client" | "spouse" | "child" | "other"; firstName: string }[];
  categoryDefaults: CategoryDefaults;
  modelPortfolios?: ModelPortfolioOption[];
  fundPortfolios?: FundPortfolioOption[];
  ownerNames: OwnerNames;
  assetClasses?: AssetClassOption[];
  portfolioAllocationsMap?: Record<string, { assetClassId: string; weight: number }[]>;
  categoryDefaultSources?: Record<string, { source: string; portfolioId?: string; portfolioName?: string; blendedReturn?: number }>;
  milestones?: ClientMilestones;
  resolvedInflationRate?: number;
  /** "wizard" hides the KPI strip + Out-of-Estate panel and renders only the
   * column indicated by `section`. Default "page" preserves the existing
   * tabbed-view behavior verbatim. */
  embed?: "page" | "wizard";
  section?: "accounts" | "liabilities";
}

const CATEGORY_LABELS: Record<AccountCategory, string> = {
  taxable: "Taxable",
  cash: "Cash",
  retirement: "Retirement",
  annuity: "Annuity",
  real_estate: "Real Estate",
  business: "Business",
  stock_options: "Stock Options",
  life_insurance: "Life Insurance",
  notes_receivable: "Notes Receivable",
};

const CATEGORY_ORDER: AccountCategory[] = [
  "taxable",
  "cash",
  "retirement",
  "annuity",
  "real_estate",
  "business",
  "stock_options",
  "life_insurance",
  "notes_receivable",
];

// Categories the Add Asset menu offers. Life-insurance policies are created
// from the Insurance section, not here.
const ADDABLE_CATEGORIES: AccountCategory[] = [
  "taxable",
  "cash",
  "retirement",
  "annuity",
  "real_estate",
  "business",
  "stock_options",
  "notes_receivable",
];

const ENTITY_TYPE_LABELS: Record<string, string> = {
  trust: "Trust",
  llc: "LLC",
  s_corp: "S Corp",
  c_corp: "C Corp",
  partnership: "Partnership",
  foundation: "Foundation",
  other: "Other",
};

const fmt = (value: string | number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number(value));

function TrashIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
      <path
        fillRule="evenodd"
        d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function ChevronDown() {
  return (
    <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
    </svg>
  );
}

function accountToInitial(a: AccountRow): AccountFormInitial {
  return {
    id: a.id,
    name: a.name,
    category: a.category,
    subType: a.subType,
    owner: a.owner,
    value: a.value,
    basis: a.basis,
    rothValue: a.rothValue ?? undefined,
    hsaCoverage: a.hsaCoverage ?? null,
    growthRate: a.growthRate,
    rmdEnabled: a.rmdEnabled ?? null,
    priorYearEndValue: a.priorYearEndValue ?? null,
    ownerEntityId: a.ownerEntityId ?? null,
    growthSource: a.growthSource,
    modelPortfolioId: a.modelPortfolioId ?? null,
    tickerPortfolioId: a.tickerPortfolioId ?? null,
    turnoverPct: a.turnoverPct ?? undefined,
    overridePctOi: a.overridePctOi ?? null,
    overridePctLtCg: a.overridePctLtCg ?? null,
    overridePctQdiv: a.overridePctQdiv ?? null,
    overridePctTaxExempt: a.overridePctTaxExempt ?? null,
    annualPropertyTax: a.annualPropertyTax ?? undefined,
    propertyTaxGrowthRate: a.propertyTaxGrowthRate ?? undefined,
    propertyTaxGrowthSource: a.propertyTaxGrowthSource,
    isDefaultChecking: a.isDefaultChecking ?? false,
    owners: a.owners,
    titlingType: a.titlingType,
    parentAccountId: a.parentAccountId ?? null,
  };
}

function noteToInitial(n: NoteReceivable): NoteReceivableFormInitial {
  return {
    id: n.id,
    name: n.name,
    faceValue: n.faceValue,
    basis: n.basis,
    asOfBalance: n.asOfBalance,
    balanceAsOfMonth: n.balanceAsOfMonth,
    balanceAsOfYear: n.balanceAsOfYear,
    interestRate: n.interestRate,
    paymentType: n.paymentType,
    monthlyPayment: n.monthlyPayment,
    startYear: n.startYear,
    startMonth: n.startMonth,
    termMonths: n.termMonths,
    linkedTrustEntityId: n.linkedTrustEntityId ?? null,
    owners: n.owners,
    extraPayments: n.extraPayments.map((ep) => ({
      id: ep.id,
      year: ep.year,
      type: ep.type,
      amount: ep.amount,
    })),
  };
}

/** Returns the projected note balance for `year` using the engine's schedule.
 * Falls back to asOfBalance / faceValue when the schedule has no row at `year`. */
function noteBalanceAtYear(n: NoteReceivable, year: number): number {
  const schedule = buildNoteReceivableSchedule(n);
  const row = schedule.find((r) => r.year === year);
  if (row) return row.endingBalance;
  if (year < (schedule[0]?.year ?? n.startYear)) {
    return n.asOfBalance ?? n.faceValue;
  }
  // Past the term — note is paid off.
  return 0;
}

function liabilityToInitial(l: LiabilityRow): LiabilityFormInitial {
  return {
    id: l.id,
    name: l.name,
    balance: l.balance,
    interestRate: l.interestRate,
    monthlyPayment: l.monthlyPayment,
    startYear: l.startYear,
    startMonth: l.startMonth,
    termMonths: l.termMonths,
    termUnit: (l.termUnit === "monthly" ? "monthly" : "annual") as "monthly" | "annual",
    balanceAsOfMonth: l.balanceAsOfMonth ?? null,
    balanceAsOfYear: l.balanceAsOfYear ?? null,
    linkedPropertyId: l.linkedPropertyId ?? null,
    ownerEntityId: l.ownerEntityId ?? null,
    isInterestDeductible: l.isInterestDeductible,
    owners: l.owners,
    parentAccountId: l.parentAccountId ?? null,
  };
}

/** Map an AccountRow (string-valued) to the BusinessAccount shape BusinessDialog expects. */
function accountRowToBusinessAccount(a: AccountRow): BusinessAccount {
  return {
    id: a.id,
    name: a.name,
    category: "business",
    subType: a.subType,
    value: Number(a.value),
    basis: Number(a.basis),
    growthRate: a.growthRate !== null ? Number(a.growthRate) : 0,
    rmdEnabled: a.rmdEnabled ?? false,
    priorYearEndValue: a.priorYearEndValue !== null && a.priorYearEndValue !== undefined
      ? Number(a.priorYearEndValue)
      : undefined,
    owners: a.owners ?? [],
    titlingType: a.titlingType ?? "jtwros",
    parentAccountId: a.parentAccountId ?? null,
  } as BusinessAccount;
}

/** Compute the liability balance at the start of the current calendar year. */
function currentYearBalance(l: LiabilityRow): number {
  const bal = parseFloat(l.balance);
  const rate = parseFloat(l.interestRate);
  const pmt = parseFloat(l.monthlyPayment);
  const asOfMonth = l.balanceAsOfMonth ?? 1;
  const asOfYear = l.balanceAsOfYear ?? l.startYear;
  const elapsedMonths = Math.max(0, (asOfYear - l.startYear) * 12 + (asOfMonth - l.startMonth));
  const origBal = calcOriginalBalance(bal, rate, pmt, elapsedMonths);
  const currentYear = new Date().getFullYear();
  if (currentYear <= l.startYear) return origBal;
  const schedule = computeAmortizationSchedule(origBal, rate, pmt, l.startYear, l.termMonths);
  const row = schedule.find((r) => r.year === currentYear - 1);
  if (row) return row.endingBalance;
  // If current year is past the loan term, balance is 0
  const lastRow = schedule[schedule.length - 1];
  return lastRow ? lastRow.endingBalance : 0;
}

// ── Dropdown for "Add Asset" category picker ──────────────────────────────────

function AddAssetMenu({ onPick }: { onPick: (cat: AccountCategory) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-on hover:bg-accent-ink"
      >
        + Add Asset <ChevronDown />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-md border border-ink-3 bg-gray-900 shadow-lg">
          {ADDABLE_CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => {
                setOpen(false);
                onPick(cat);
              }}
              className="block w-full px-3 py-2 text-left text-sm text-gray-200 hover:bg-gray-800"
            >
              {CATEGORY_LABELS[cat]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Balance Sheet ────────────────────────────────────────────────────────────

export default function BalanceSheetView({
  clientId,
  accounts,
  liabilities,
  notesReceivable = [],
  incomes = [],
  expenses = [],
  entities,
  familyMembers,
  categoryDefaults,
  modelPortfolios,
  fundPortfolios,
  ownerNames,
  assetClasses,
  portfolioAllocationsMap,
  categoryDefaultSources,
  milestones,
  resolvedInflationRate,
  embed = "page",
  section,
  planStartYear,
  planEndYear,
  primaryClientBirthYear,
}: BalanceSheetViewProps) {
  const isWizard = embed === "wizard";
  const showAssetsCol = !isWizard || section === "accounts";
  const showLiabilitiesCol = !isWizard || section === "liabilities";
  const router = useRouter();
  const { showToast } = useToast();
  const [refreshingPrices, setRefreshingPrices] = useState(false);

  async function handleRefreshPrices() {
    setRefreshingPrices(true);
    try {
      const s = await refreshClientHoldingPrices(clientId);
      const missing = s.tickersMissing.length
        ? ` Couldn't price: ${s.tickersMissing.join(", ")}.`
        : "";
      const msg =
        s.holdingsConsidered === 0
          ? "No tickered holdings to refresh."
          : s.holdingsUpdated > 0
            ? `Updated ${s.holdingsUpdated} holding${s.holdingsUpdated === 1 ? "" : "s"}.${missing}`
            : s.tickersMissing.length
              ? `Couldn't fetch prices.${missing}`
              : "Prices already current.";
      showToast({ message: msg });
      if (s.holdingsUpdated > 0) router.refresh();
    } catch (err) {
      showToast({ message: err instanceof Error ? err.message : "Price refresh failed." });
    } finally {
      setRefreshingPrices(false);
    }
  }

  const writer = useScenarioWriter(clientId);
  const withScenario = useScenarioPreservingHref();

  const [assetsEdit, setAssetsEdit] = useState(false);
  const [liabilitiesEdit, setLiabilitiesEdit] = useState(false);

  // Controlled Add Asset dialog (after category pick)
  const [addCategory, setAddCategory] = useState<AccountCategory | null>(null);

  const [editingAccount, setEditingAccount] = useState<AccountRow | null>(null);
  const [deletingAccount, setDeletingAccount] = useState<AccountRow | null>(null);

  const [editingLiability, setEditingLiability] = useState<LiabilityRow | null>(null);
  const [deletingLiability, setDeletingLiability] = useState<LiabilityRow | null>(null);

  const [editingNote, setEditingNote] = useState<NoteReceivable | null>(null);
  const [deletingNote, setDeletingNote] = useState<NoteReceivable | null>(null);

  const [editingBusiness, setEditingBusiness] = useState<BusinessAccount | null>(null);
  const [businessDialogOpen, setBusinessDialogOpen] = useState(false);
  const [addLiabilityOpen, setAddLiabilityOpen] = useState(false);
  // When "+ Add sub-account" / "+ Add sub-liability" fires from inside the
  // Business dialog's Assets tab, capture the business id so the freshly-opened
  // add dialog seeds parent-business → that business (ownership defaults to it).
  const [addAccountParentBusinessId, setAddAccountParentBusinessId] = useState<string | null>(null);
  const [addLiabilityParentBusinessId, setAddLiabilityParentBusinessId] = useState<string | null>(null);

  function openAddBusiness() {
    setEditingBusiness(null);
    setBusinessDialogOpen(true);
  }

  function openEditBusiness(business: AccountRow) {
    setEditingBusiness(accountRowToBusinessAccount(business));
    setBusinessDialogOpen(true);
  }

  // Expand/collapse state for business rows — keyed by top-level business account id.
  const [expandedBusinessIds, setExpandedBusinessIds] = useState<Set<string>>(new Set());
  const toggleBusiness = (id: string) =>
    setExpandedBusinessIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Asset categories collapse by default; user expands the ones they care about.
  const [expandedCategories, setExpandedCategories] = useState<Set<AccountCategory>>(new Set());
  const toggleCategory = (cat: AccountCategory) =>
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });

  // Out-of-estate entity groups collapse by default. Keyed by entity id, with
  // the sentinel "__business_interests__" for the flat-business-entities card.
  const [expandedOutOfEstate, setExpandedOutOfEstate] = useState<Set<string>>(new Set());
  const toggleOutOfEstate = (key: string) =>
    setExpandedOutOfEstate((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  // Which business' Incomes popover is open (null = none).
  const [incomesPopoverFor, setIncomesPopoverFor] = useState<string | null>(null);

  const entityMap = Object.fromEntries(entities.map((e) => [e.id, e]));
  // Term policies (cash_value = 0) are hidden from Net Worth — face value pays out only on
  // death, so it's not an asset on the balance sheet. They're managed in the Insurance tab.
  const isVisibleInNetWorth = (a: AccountRow) =>
    !(a.category === "life_insurance" && Number(a.value) === 0);

  const BUSINESS_ENTITY_TYPES = new Set(["llc", "s_corp", "c_corp", "partnership", "other"]);
  // A business entity counts as in-estate when its `entity_owners` rows sum to
  // 100% (or when the rows are absent — legacy data predates the join table).
  // Mirrors `familyOwnedFraction` in lib/estate/in-estate-at-year.ts; kept
  // binary here to avoid splitting individual rows in the UI.
  const isFamilyOwnedBusiness = (entityId: string | null | undefined): boolean => {
    if (!entityId) return false;
    const e = entityMap[entityId];
    if (!e || !e.entityType || !BUSINESS_ENTITY_TYPES.has(e.entityType)) return false;
    if (e.owners == null) return true;
    const sum = e.owners.reduce((s, o) => s + (o.percent ?? 0), 0);
    return sum >= 0.9999;
  };

  // An account belongs in-estate when it has no entity owner, or when the
  // owning entity is a family-owned business interest.
  const accountInEstate = (a: AccountRow): boolean =>
    !a.ownerEntityId || isFamilyOwnedBusiness(a.ownerEntityId);

  // Legacy notes_receivable accounts are sourced from `notesReceivable` now.
  const nonNoteAccounts = accounts.filter((a) => a.category !== "notes_receivable");

  const inEstate = nonNoteAccounts.filter((a) => accountInEstate(a) && isVisibleInNetWorth(a));
  const outOfEstate = nonNoteAccounts.filter(
    (a) => !accountInEstate(a) && isVisibleInNetWorth(a),
  );

  // Build child indexes for the new business-as-account model. Top-level
  // business accounts may own sub-accounts (parentAccountId set) and child
  // liabilities. Children are hidden from the top-level category lists and
  // surface beneath their parent when the row is expanded.
  const childAccountsByParentId = new Map<string, AccountRow[]>();
  for (const a of inEstate) {
    if (!a.parentAccountId) continue;
    const arr = childAccountsByParentId.get(a.parentAccountId) ?? [];
    arr.push(a);
    childAccountsByParentId.set(a.parentAccountId, arr);
  }
  const childLiabilitiesByParentId = new Map<string, LiabilityRow[]>();
  for (const l of liabilities) {
    if (!l.parentAccountId) continue;
    const arr = childLiabilitiesByParentId.get(l.parentAccountId) ?? [];
    arr.push(l);
    childLiabilitiesByParentId.set(l.parentAccountId, arr);
  }
  const incomesByOwnerAccountId = new Map<string, { id: string; name: string }[]>();
  for (const i of incomes) {
    if (!i.ownerAccountId) continue;
    const arr = incomesByOwnerAccountId.get(i.ownerAccountId) ?? [];
    arr.push({ id: i.id, name: i.name });
    incomesByOwnerAccountId.set(i.ownerAccountId, arr);
  }
  // Consolidated business value: own value + sum of in-estate child account
  // values. Liabilities stay on the Liabilities column — not netted here.
  const consolidatedBusinessValue = (biz: AccountRow): number => {
    const kids = childAccountsByParentId.get(biz.id) ?? [];
    return kids.reduce((s, k) => s + Number(k.value), Number(biz.value));
  };

  const inEstateByCategory: Record<AccountCategory, AccountRow[]> = {
    taxable: [],
    cash: [],
    retirement: [],
    annuity: [],
    real_estate: [],
    business: [],
    stock_options: [],
    life_insurance: [],
    notes_receivable: [],
  };
  // Top-level accounts only — children render under their parent's expanded view.
  for (const a of inEstate) {
    if (a.parentAccountId) continue;
    inEstateByCategory[a.category].push(a);
  }
  // Top-level liabilities only — children render under their parent business.
  const topLevelLiabilities = liabilities.filter((l) => !l.parentAccountId);

  // Notes receivable: project balance to prior-year-end (≈ current balance),
  // matching how liability balances are displayed.
  const noteDisplayYear = new Date().getFullYear() - 1;
  type NoteRow = { note: NoteReceivable; value: number };
  const noteRows: NoteRow[] = notesReceivable.map((n) => ({
    note: n,
    value: noteBalanceAtYear(n, noteDisplayYear),
  }));
  const notesReceivableTotal = noteRows.reduce((s, r) => s + r.value, 0);

  const outByEntity = new Map<string, AccountRow[]>();
  for (const a of outOfEstate) {
    const key = a.ownerEntityId!;
    const arr = outByEntity.get(key) ?? [];
    arr.push(a);
    outByEntity.set(key, arr);
  }

  // Business-entity flat valuations split into in-estate (family-owned) and
  // out-of-estate (everything else: partial-family-owned legacy rows, future
  // trust-on-business ownership). In-estate rows render under the Business
  // category in the Assets column; OOE rows keep their dedicated section.
  const businessEntitiesWithValue = entities.filter(
    (e) => e.entityType && BUSINESS_ENTITY_TYPES.has(e.entityType) && Number(e.value ?? "0") > 0,
  );
  const inEstateBusinessEntityRows = businessEntitiesWithValue.filter((e) =>
    isFamilyOwnedBusiness(e.id),
  );
  const outOfEstateBusinessEntityRows = businessEntitiesWithValue.filter(
    (e) => !isFamilyOwnedBusiness(e.id),
  );
  const inEstateBusinessEntityTotal = inEstateBusinessEntityRows.reduce(
    (s, e) => s + Number(e.value ?? "0"),
    0,
  );
  const outOfEstateBusinessEntityTotal = outOfEstateBusinessEntityRows.reduce(
    (s, e) => s + Number(e.value ?? "0"),
    0,
  );

  const totalInEstate =
    inEstate.reduce((s, a) => s + Number(a.value), 0) +
    inEstateBusinessEntityTotal +
    notesReceivableTotal;
  const totalOutOfEstate =
    outOfEstate.reduce((s, a) => s + Number(a.value), 0) + outOfEstateBusinessEntityTotal;
  const totalAssets = totalInEstate + totalOutOfEstate;
  const totalLiabilities = liabilities.reduce((s, l) => s + currentYearBalance(l), 0);
  const netWorth = totalInEstate - totalLiabilities;
  const realEstateAccounts = accounts
    .filter((a) => a.category === "real_estate")
    .map((a) => ({ id: a.id, name: a.name }));
  // Top-level business accounts that can serve as parents on add/edit
  // account/liability forms. Excludes nested businesses (defensive — Phase 4
  // doesn't currently support business-under-business).
  const businessOptions = accounts
    .filter((a) => a.category === "business" && a.parentAccountId == null)
    .map((a) => ({ id: a.id, name: a.name }));

  async function performAccountDelete(id: string) {
    const res = await writer.submit(
      { op: "remove", targetKind: "account", targetId: id },
      { url: `/api/clients/${clientId}/accounts/${id}`, method: "DELETE" },
    );
    if (!res.ok && res.status !== 204) {
      const json = await res.json().catch(() => ({}));
      alert(json.error ?? "Failed to delete account");
      return;
    }
    setDeletingAccount(null);
    setEditingAccount(null);
    setEditingBusiness(null);
    setBusinessDialogOpen(false);
    router.refresh();
  }

  async function performNoteDelete(id: string) {
    const res = await fetch(`/api/clients/${clientId}/notes-receivable/${id}`, {
      method: "DELETE",
    });
    if (!res.ok && res.status !== 204) {
      const json = await res.json().catch(() => ({}));
      alert(json.error ?? "Failed to delete note");
      return;
    }
    setDeletingNote(null);
    setEditingNote(null);
    router.refresh();
  }

  async function performLiabilityDelete(id: string) {
    const res = await writer.submit(
      { op: "remove", targetKind: "liability", targetId: id },
      { url: `/api/clients/${clientId}/liabilities/${id}`, method: "DELETE" },
    );
    if (!res.ok && res.status !== 204) {
      const json = await res.json().catch(() => ({}));
      alert(json.error ?? "Failed to delete liability");
      return;
    }
    setDeletingLiability(null);
    setEditingLiability(null);
    router.refresh();
  }

  function handleAccountClick(a: AccountRow) {
    if (assetsEdit) return; // edit mode: user is toggling delete affordances, not opening details
    if (a.category === "life_insurance") {
      router.push(withScenario(`/clients/${clientId}/details/insurance?policy=${a.id}`));
      return;
    }
    setEditingAccount(a);
  }

  function ownerDisplay(a: AccountRow) {
    if (a.ownerEntityId && entityMap[a.ownerEntityId]) return entityMap[a.ownerEntityId].name;
    return individualOwnerLabel(a.owner as "client" | "spouse" | "joint", ownerNames);
  }

  function handleNoteClick(n: NoteReceivable) {
    if (assetsEdit) return;
    setEditingNote(n);
  }

  function noteOwnerDisplay(n: NoteReceivable): string {
    const owners = n.owners ?? [];
    if (owners.length === 0) return "—";
    const first = owners[0];
    if (first.kind === "entity") {
      return entityMap[first.entityId]?.name ?? "Entity";
    }
    if (first.kind === "family_member") {
      const fm = (familyMembers ?? []).find((m) => m.id === first.familyMemberId);
      if (!fm) return "Household";
      if (fm.role === "client" || fm.role === "spouse") {
        return individualOwnerLabel(fm.role, ownerNames);
      }
      return fm.firstName;
    }
    return "External";
  }

  function growthDisplay(a: AccountRow) {
    if (a.growthRate == null) {
      const d = Number(categoryDefaults[a.category]) * 100;
      return `${d.toFixed(1)}% (default)`;
    }
    return `${(Number(a.growthRate) * 100).toFixed(1)}%`;
  }

  return (
    <div className="space-y-6">
      {/* KPI row */}
      {!isWizard && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Kpi label="Assets (in estate)" value={fmt(totalInEstate)} accent="text-gray-100" />
          <Kpi label="Liabilities" value={`(${fmt(totalLiabilities)})`} accent="text-red-400" />
          <Kpi label="Net Worth" value={fmt(netWorth)} accent={netWorth >= 0 ? "text-green-500" : "text-red-500"} />
          <Kpi
            label="Out of estate"
            value={fmt(totalOutOfEstate)}
            accent="text-amber-300"
            subtitle={outOfEstate.length ? `${outOfEstate.length} asset${outOfEstate.length > 1 ? "s" : ""}` : "—"}
          />
        </div>
      )}

      {/* Two columns (single column in wizard mode) */}
      <div className={isWizard ? "grid grid-cols-1 gap-6" : "grid grid-cols-1 gap-6 lg:grid-cols-2"}>
        {/* Assets column */}
        {showAssetsCol && (
        <Panel
          title="Assets"
          totalLabel={`Total ${fmt(totalInEstate)}`}
          actions={
            <div className="flex items-center gap-2">
              {(nonNoteAccounts.length > 0 || noteRows.length > 0) && (
                <EditToggle on={assetsEdit} onToggle={() => setAssetsEdit((v) => !v)} />
              )}
              {nonNoteAccounts.length > 0 && (
                <button
                  type="button"
                  onClick={handleRefreshPrices}
                  disabled={refreshingPrices}
                  className="rounded-md border border-hair bg-card px-3 py-1.5 text-sm font-medium text-ink hover:bg-card-hover disabled:opacity-50"
                >
                  {refreshingPrices ? "Refreshing…" : "Refresh prices"}
                </button>
              )}
              <AddAssetMenu onPick={(cat) => cat === "business" ? openAddBusiness() : setAddCategory(cat)} />
            </div>
          }
        >
          {inEstate.length === 0 &&
          inEstateBusinessEntityRows.length === 0 &&
          noteRows.length === 0 ? (
            <EmptyRow message="No assets yet. Click Add Asset to get started." />
          ) : (
            CATEGORY_ORDER.map((cat) => {
              const items = inEstateByCategory[cat];
              const flatBusinessRows = cat === "business" ? inEstateBusinessEntityRows : [];
              const noteCatRows = cat === "notes_receivable" ? noteRows : [];
              if (
                items.length === 0 &&
                flatBusinessRows.length === 0 &&
                noteCatRows.length === 0
              )
                return null;
              const accountSubtotal = items.reduce(
                (s, a) =>
                  s + (cat === "business" ? consolidatedBusinessValue(a) : Number(a.value)),
                0,
              );
              const flatSubtotal = flatBusinessRows.reduce(
                (s, e) => s + Number(e.value ?? "0"),
                0,
              );
              const noteSubtotal = noteCatRows.reduce((s, r) => s + r.value, 0);
              const subtotal = accountSubtotal + flatSubtotal + noteSubtotal;
              return (
                <CategoryGroup
                  key={cat}
                  label={CATEGORY_LABELS[cat]}
                  total={fmt(subtotal)}
                  expanded={expandedCategories.has(cat)}
                  onToggle={() => toggleCategory(cat)}
                >
                  {items.map((a) =>
                    cat === "business" ? (
                      <BusinessRowGroup
                        key={a.id}
                        biz={a}
                        children_={childAccountsByParentId.get(a.id) ?? []}
                        childLiabilities={childLiabilitiesByParentId.get(a.id) ?? []}
                        ownedIncomes={incomesByOwnerAccountId.get(a.id) ?? []}
                        expanded={expandedBusinessIds.has(a.id)}
                        onToggle={() => toggleBusiness(a.id)}
                        incomesPopoverOpen={incomesPopoverFor === a.id}
                        onToggleIncomesPopover={() =>
                          setIncomesPopoverFor((cur) => (cur === a.id ? null : a.id))
                        }
                        consolidatedValue={consolidatedBusinessValue(a)}
                        onClickRow={() => !assetsEdit && openEditBusiness(a)}
                        onDeleteRow={() => setDeletingAccount(a)}
                        onClickChild={(child) => handleAccountClick(child)}
                        onDeleteChild={(child) => setDeletingAccount(child)}
                        onClickChildLiability={(l) => !liabilitiesEdit && setEditingLiability(l)}
                        editMode={assetsEdit}
                        ownerDisplay={ownerDisplay}
                        growthDisplay={growthDisplay}
                        currentYearBalance={currentYearBalance}
                      />
                    ) : (
                      <Row
                        key={a.id}
                        onClick={() => handleAccountClick(a)}
                        editMode={assetsEdit}
                        onDelete={() => setDeletingAccount(a)}
                        deletable={!a.isDefaultChecking}
                        label={a.name}
                        subLabel={`${ownerDisplay(a)} · ${growthDisplay(a)}`}
                        value={fmt(a.value)}
                      />
                    ),
                  )}
                  {noteCatRows.map(({ note, value }) => (
                    <Row
                      key={note.id}
                      onClick={() => handleNoteClick(note)}
                      editMode={assetsEdit}
                      onDelete={() => setDeletingNote(note)}
                      label={note.name}
                      labelBadge={
                        note.linkedTrustEntityId ? (
                          <span className="inline-flex shrink-0 items-center rounded-full bg-amber-900/30 px-2 py-0.5 text-xs text-amber-300">
                            → {entityMap[note.linkedTrustEntityId]?.name ?? "Trust"}
                          </span>
                        ) : undefined
                      }
                      subLabel={`${noteOwnerDisplay(note)} · ${(note.interestRate * 100).toFixed(2)}%`}
                      value={fmt(value)}
                    />
                  ))}
                  {flatBusinessRows.map((e) => (
                    <a
                      key={`flat-${e.id}`}
                      href={withScenario(`/clients/${clientId}/details/family`)}
                      className="flex items-center justify-between px-4 py-2 hover:bg-gray-800/60"
                    >
                      <div>
                        <div className="text-sm font-medium text-gray-100">{e.name}</div>
                        <div className="text-xs text-gray-400">
                          {ENTITY_TYPE_LABELS[e.entityType ?? "other"] ?? "Entity"} · edit in Family
                        </div>
                      </div>
                      <span className="text-sm font-medium text-gray-100">{fmt(Number(e.value ?? "0"))}</span>
                    </a>
                  ))}
                </CategoryGroup>
              );
            })
          )}
        </Panel>
        )}

        {/* Liabilities column */}
        {showLiabilitiesCol && (
        <Panel
          title="Liabilities"
          totalLabel={`Total ${fmt(totalLiabilities)}`}
          totalClassName="text-red-400"
          actions={
            <div className="flex items-center gap-2">
              {liabilities.length > 0 && (
                <EditToggle on={liabilitiesEdit} onToggle={() => setLiabilitiesEdit((v) => !v)} />
              )}
              <AddLiabilityDialog
                clientId={clientId}
                realEstateAccounts={realEstateAccounts}
                entities={entities}
                businesses={businessOptions}
                familyMembers={familyMembers}
                clientFirstName={ownerNames.clientName.split(" ")[0]}
                spouseFirstName={ownerNames.spouseName?.split(" ")[0]}
              />
            </div>
          }
        >
          {topLevelLiabilities.length === 0 ? (
            <EmptyRow message="No liabilities yet." />
          ) : (
            <div className="overflow-hidden rounded-md border border-gray-700 bg-gray-900/60">
              <div className="divide-y divide-gray-800">
                {topLevelLiabilities.map((l) => (
                  <Row
                    key={l.id}
                    onClick={() => !liabilitiesEdit && setEditingLiability(l)}
                    editMode={liabilitiesEdit}
                    onDelete={() => setDeletingLiability(l)}
                    label={l.name}
                    subLabel={Number(l.interestRate) > 0 ? `${(Number(l.interestRate) * 100).toFixed(2)}% interest` : undefined}
                    value={`(${fmt(currentYearBalance(l))})`}
                    valueClassName="text-red-400"
                  />
                ))}
              </div>
            </div>
          )}
        </Panel>
        )}
      </div>

      {/* Out of Estate */}
      {!isWizard && (outOfEstate.length > 0 || outOfEstateBusinessEntityRows.length > 0) && (
        <div className="rounded-lg border border-amber-900/40 bg-amber-950/10 p-4">
          <div className="mb-3 flex items-baseline justify-between">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wider text-amber-300">Out of Estate</h3>
              <p className="text-xs text-amber-200/60">
                Assets held outside the household — irrevocable trusts and entities not owned by household members. Not included in the household net-worth calculation above.
              </p>
            </div>
            <span className="text-sm font-medium text-amber-200">{fmt(totalOutOfEstate)}</span>
          </div>

          <div className="space-y-3">
            {Array.from(outByEntity.entries()).map(([entityId, rows]) => {
              const subtotal = rows.reduce((s, a) => s + Number(a.value), 0);
              const entityName = entityMap[entityId]?.name ?? "Unknown entity";
              const expanded = expandedOutOfEstate.has(entityId);
              return (
                <div key={entityId} className="overflow-hidden rounded-md border border-amber-900/40 bg-gray-900/60">
                  <button
                    type="button"
                    onClick={() => toggleOutOfEstate(entityId)}
                    aria-expanded={expanded}
                    className={`flex w-full items-center justify-between bg-amber-900/15 px-3 py-2 text-left hover:bg-amber-900/25 ${expanded ? "border-b border-amber-900/40" : ""}`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center text-amber-200/70">
                        {expanded ? <ChevronDown /> : <ChevronRight />}
                      </span>
                      <span className="text-xs font-semibold uppercase tracking-wider text-amber-200">
                        {entityName}
                      </span>
                    </span>
                    <span className="text-xs font-medium text-amber-200/80">{fmt(subtotal)}</span>
                  </button>
                  {expanded && (
                    <div className="divide-y divide-gray-800">
                      {rows.map((a) => (
                        <div
                          key={a.id}
                          onClick={() => handleAccountClick(a)}
                          className="flex cursor-pointer items-center justify-between px-4 py-2 hover:bg-gray-800/60"
                        >
                          <div>
                            <div className="text-sm font-medium text-gray-100">{a.name}</div>
                            <div className="text-xs text-gray-400">
                              {CATEGORY_LABELS[a.category]} · {growthDisplay(a)}
                            </div>
                          </div>
                          <span className="text-sm font-medium text-gray-100">{fmt(a.value)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {outOfEstateBusinessEntityRows.length > 0 && (() => {
              const expanded = expandedOutOfEstate.has("__business_interests__");
              return (
                <div className="overflow-hidden rounded-md border border-amber-900/40 bg-gray-900/60">
                  <button
                    type="button"
                    onClick={() => toggleOutOfEstate("__business_interests__")}
                    aria-expanded={expanded}
                    className={`flex w-full items-center justify-between bg-amber-900/15 px-3 py-2 text-left hover:bg-amber-900/25 ${expanded ? "border-b border-amber-900/40" : ""}`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center text-amber-200/70">
                        {expanded ? <ChevronDown /> : <ChevronRight />}
                      </span>
                      <span className="text-xs font-semibold uppercase tracking-wider text-amber-200">
                        Business interests
                      </span>
                    </span>
                    <span className="text-xs font-medium text-amber-200/80">{fmt(outOfEstateBusinessEntityTotal)}</span>
                  </button>
                  {expanded && (
                    <div className="divide-y divide-gray-800">
                      {outOfEstateBusinessEntityRows.map((e) => (
                        <a
                          key={e.id}
                          href={withScenario(`/clients/${clientId}/details/family`)}
                          className="flex items-center justify-between px-4 py-2 hover:bg-gray-800/60"
                        >
                          <div>
                            <div className="text-sm font-medium text-gray-100">{e.name}</div>
                            <div className="text-xs text-gray-400">
                              {ENTITY_TYPE_LABELS[e.entityType ?? "other"] ?? "Entity"} · edit in Family
                            </div>
                          </div>
                          <span className="text-sm font-medium text-gray-100">{fmt(Number(e.value ?? "0"))}</span>
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Business dialog — handles both add (from the menu) and edit (row click).
       *  Every other category routes to the shared AddAccountDialog.
       *  Conditionally mounted so every open is a fresh session — BusinessDialog
       *  seeds `mode`/`currentBusiness` from props via useState (initial-value only),
       *  so a persistently-mounted instance would keep stale state across opens. */}
      {businessDialogOpen && (
        <BusinessDialog
          clientId={clientId}
          mode={editingBusiness ? "edit" : "add"}
          business={editingBusiness ?? undefined}
          open
          onOpenChange={(o) => {
            if (!o) {
              setBusinessDialogOpen(false);
              setEditingBusiness(null);
            }
          }}
          familyMembers={familyMembers}
          entities={entities}
          allAccounts={accounts}
          allLiabilities={liabilities}
          onDataChanged={() => router.refresh()}
          onSaved={() => {/* router.refresh handled inside the form */}}
          onRequestDelete={
            editingBusiness
              ? () => setDeletingAccount(
                  accounts.find((a) => a.id === editingBusiness.id) ?? null,
                )
              : undefined
          }
          onOpenAddAccount={(bizId) => {
            setAddAccountParentBusinessId(bizId);
            setAddCategory("cash");
          }}
          onOpenAddLiability={(bizId) => {
            setAddLiabilityParentBusinessId(bizId);
            setAddLiabilityOpen(true);
          }}
          incomes={incomes}
          expenses={expenses}
          planStartYear={planStartYear}
          planEndYear={planEndYear}
          primaryClientBirthYear={primaryClientBirthYear}
          // TODO Task 11+: wire onOpenAddIncome/onOpenAddExpense/onEditIncome/onEditExpense
          // to the existing IncomeDialog/ExpenseDialog in income-expenses-view.tsx.
          // Those dialogs are mounted in a sibling view so cross-component wiring is
          // non-trivial. For v1 the Flows tab is read-only; add/edit uses existing entry points.
        />
      )}
      <AddAccountDialog
        clientId={clientId}
        category={addCategory ?? undefined}
        label={addCategory ? CATEGORY_LABELS[addCategory] : undefined}
        entities={entities}
        businesses={businessOptions}
        familyMembers={familyMembers}
        categoryDefaults={categoryDefaults}
        modelPortfolios={modelPortfolios}
        fundPortfolios={fundPortfolios}
        ownerNames={ownerNames}
        assetClasses={assetClasses}
        portfolioAllocationsMap={portfolioAllocationsMap}
        categoryDefaultSources={categoryDefaultSources}
        milestones={milestones}
        clientFirstName={ownerNames.clientName.split(" ")[0]}
        spouseFirstName={ownerNames.spouseName?.split(" ")[0]}
        existingAccountNames={accounts.map((a) => a.name)}
        resolvedInflationRate={resolvedInflationRate}
        initialParentAccountId={addAccountParentBusinessId}
        open={addCategory !== null}
        onOpenChange={(o) => {
          if (!o) {
            setAddCategory(null);
            setAddAccountParentBusinessId(null);
          }
        }}
      />

      {/* Edit dialogs */}
      <AddAccountDialog
        clientId={clientId}
        entities={entities}
        businesses={businessOptions}
        familyMembers={familyMembers}
        categoryDefaults={categoryDefaults}
        modelPortfolios={modelPortfolios}
        fundPortfolios={fundPortfolios}
        ownerNames={ownerNames}
        assetClasses={assetClasses}
        categoryDefaultSources={categoryDefaultSources}
        portfolioAllocationsMap={portfolioAllocationsMap}
        milestones={milestones}
        clientFirstName={ownerNames.clientName.split(" ")[0]}
        spouseFirstName={ownerNames.spouseName?.split(" ")[0]}
        resolvedInflationRate={resolvedInflationRate}
        open={!!editingAccount}
        onOpenChange={(o) => !o && setEditingAccount(null)}
        editing={editingAccount ? accountToInitial(editingAccount) : undefined}
        onRequestDelete={() => {
          if (editingAccount) setDeletingAccount(editingAccount);
        }}
      />

      <AddLiabilityDialog
        clientId={clientId}
        realEstateAccounts={realEstateAccounts}
        entities={entities}
        businesses={businessOptions}
        familyMembers={familyMembers}
        clientFirstName={ownerNames.clientName.split(" ")[0]}
        spouseFirstName={ownerNames.spouseName?.split(" ")[0]}
        open={!!editingLiability}
        onOpenChange={(o) => !o && setEditingLiability(null)}
        editing={editingLiability ? liabilityToInitial(editingLiability) : undefined}
        onRequestDelete={() => {
          if (editingLiability) setDeletingLiability(editingLiability);
        }}
      />

      {/* Second AddLiabilityDialog instance — opens from BusinessAssetsTab's
          "+ Add sub-liability" button. Distinct from the legacy menu-triggered
          instance above; consolidate when the legacy add menu is reworked. */}
      <AddLiabilityDialog
        clientId={clientId}
        realEstateAccounts={realEstateAccounts}
        entities={entities}
        businesses={businessOptions}
        familyMembers={familyMembers}
        clientFirstName={ownerNames.clientName.split(" ")[0]}
        spouseFirstName={ownerNames.spouseName?.split(" ")[0]}
        initialParentAccountId={addLiabilityParentBusinessId}
        open={addLiabilityOpen}
        onOpenChange={(o) => {
          if (!o) {
            setAddLiabilityOpen(false);
            setAddLiabilityParentBusinessId(null);
          }
        }}
      />

      <AddAccountDialog
        clientId={clientId}
        entities={entities}
        familyMembers={familyMembers}
        categoryDefaults={categoryDefaults}
        modelPortfolios={modelPortfolios}
        fundPortfolios={fundPortfolios}
        ownerNames={ownerNames}
        assetClasses={assetClasses}
        categoryDefaultSources={categoryDefaultSources}
        portfolioAllocationsMap={portfolioAllocationsMap}
        milestones={milestones}
        clientFirstName={ownerNames.clientName.split(" ")[0]}
        spouseFirstName={ownerNames.spouseName?.split(" ")[0]}
        resolvedInflationRate={resolvedInflationRate}
        open={!!editingNote}
        onOpenChange={(o) => !o && setEditingNote(null)}
        editingNote={editingNote ? noteToInitial(editingNote) : undefined}
        onRequestDelete={() => {
          if (editingNote) setDeletingNote(editingNote);
        }}
      />

      <AccountDeleteDialog
        clientId={clientId}
        account={deletingAccount ? { id: deletingAccount.id, name: deletingAccount.name } : null}
        onCancel={() => setDeletingAccount(null)}
        onConfirm={async () => {
          if (deletingAccount) await performAccountDelete(deletingAccount.id);
        }}
      />

      <ConfirmDeleteDialog
        open={!!deletingLiability}
        title="Delete Liability"
        message={deletingLiability ? `Delete "${deletingLiability.name}"?` : ""}
        onCancel={() => setDeletingLiability(null)}
        onConfirm={async () => {
          if (deletingLiability) await performLiabilityDelete(deletingLiability.id);
        }}
      />

      <ConfirmDeleteDialog
        open={!!deletingNote}
        title="Delete Note Receivable"
        message={deletingNote ? `Delete "${deletingNote.name}"?` : ""}
        onCancel={() => setDeletingNote(null)}
        onConfirm={async () => {
          if (deletingNote) await performNoteDelete(deletingNote.id);
        }}
      />
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Kpi({
  label,
  value,
  accent,
  subtitle,
}: {
  label: string;
  value: string;
  accent: string;
  subtitle?: string;
}) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/60 px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wider text-gray-400">{label}</p>
      <p className={`mt-1 text-lg font-bold ${accent}`}>{value}</p>
      {subtitle && <p className="text-xs text-gray-400">{subtitle}</p>}
    </div>
  );
}

function Panel({
  title,
  totalLabel,
  totalClassName,
  actions,
  children,
}: {
  title: string;
  totalLabel: string;
  totalClassName?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/30">
      <div className="flex items-center justify-between rounded-t-lg border-b border-gray-800 bg-gray-900 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-100">{title}</h2>
          <p className={`text-xs ${totalClassName ?? "text-gray-400"}`}>{totalLabel}</p>
        </div>
        {actions}
      </div>
      <div className="space-y-3 p-3">{children}</div>
    </div>
  );
}

function EditToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={`rounded-md border px-3 py-1 text-xs font-medium ${
        on
          ? "border-accent bg-accent/15 text-accent-ink"
          : "border-gray-600 bg-gray-900 text-gray-300 hover:bg-gray-800"
      }`}
    >
      {on ? "Done" : "Edit"}
    </button>
  );
}

function CategoryGroup({
  label,
  total,
  expanded,
  onToggle,
  children,
}: {
  label: string;
  total: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-md border border-gray-700 bg-gray-900/60">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className={`flex w-full items-center justify-between bg-gray-800/60 px-3 py-2 text-left hover:bg-gray-800 ${expanded ? "border-b border-gray-700" : ""}`}
      >
        <span className="flex items-center gap-2">
          <span className="flex h-4 w-4 shrink-0 items-center justify-center text-gray-400">
            {expanded ? <ChevronDown /> : <ChevronRight />}
          </span>
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-200">{label}</span>
        </span>
        <span className="text-xs font-medium text-gray-300">{total}</span>
      </button>
      {expanded && <div className="divide-y divide-gray-800">{children}</div>}
    </div>
  );
}

function Row({
  onClick,
  editMode,
  onDelete,
  deletable = true,
  label,
  labelBadge,
  subLabel,
  value,
  valueClassName,
}: {
  onClick: () => void;
  editMode: boolean;
  onDelete: () => void;
  deletable?: boolean;
  label: string;
  labelBadge?: ReactNode;
  subLabel?: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div
      onClick={onClick}
      className="flex cursor-pointer items-center justify-between px-4 py-2 hover:bg-gray-800/60"
    >
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-gray-100">
          <span className="truncate">{label}</span>
          {labelBadge}
        </div>
        {subLabel && <div className="truncate text-xs text-gray-400">{subLabel}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className={`text-sm font-medium ${valueClassName ?? "text-gray-100"}`}>{value}</span>
        {editMode && deletable && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="text-white hover:text-white"
            aria-label={`Delete ${label}`}
          >
            <TrashIcon />
          </button>
        )}
      </div>
    </div>
  );
}

function EmptyRow({ message }: { message: string }) {
  return <div className="px-4 py-8 text-center text-sm text-gray-400">{message}</div>;
}

interface BusinessRowGroupProps {
  biz: AccountRow;
  children_: AccountRow[];
  childLiabilities: LiabilityRow[];
  ownedIncomes: { id: string; name: string }[];
  expanded: boolean;
  onToggle: () => void;
  incomesPopoverOpen: boolean;
  onToggleIncomesPopover: () => void;
  consolidatedValue: number;
  onClickRow: () => void;
  onDeleteRow: () => void;
  onClickChild: (child: AccountRow) => void;
  onDeleteChild: (child: AccountRow) => void;
  onClickChildLiability: (l: LiabilityRow) => void;
  editMode: boolean;
  ownerDisplay: (a: AccountRow) => string;
  growthDisplay: (a: AccountRow) => string;
  currentYearBalance: (l: LiabilityRow) => number;
}

function BusinessRowGroup({
  biz,
  children_,
  childLiabilities,
  ownedIncomes,
  expanded,
  onToggle,
  incomesPopoverOpen,
  onToggleIncomesPopover,
  consolidatedValue,
  onClickRow,
  onDeleteRow,
  onClickChild,
  onDeleteChild,
  onClickChildLiability,
  editMode,
  ownerDisplay,
  growthDisplay,
  currentYearBalance,
}: BusinessRowGroupProps) {
  const hasChildren = children_.length > 0 || childLiabilities.length > 0 || ownedIncomes.length > 0;
  return (
    <>
      <div className="flex items-center justify-between px-4 py-2 hover:bg-gray-800/60">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          className="mr-2 flex h-5 w-5 shrink-0 items-center justify-center text-gray-400 hover:text-gray-100 disabled:opacity-40"
          aria-label={expanded ? "Collapse" : "Expand"}
          aria-expanded={expanded}
          disabled={!hasChildren}
        >
          {expanded ? <ChevronDown /> : <ChevronRight />}
        </button>
        <div
          onClick={onClickRow}
          className="flex flex-1 cursor-pointer items-center justify-between"
        >
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-gray-100">{biz.name}</div>
            <div className="truncate text-xs text-gray-400">
              {ownerDisplay(biz)} · {growthDisplay(biz)}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-gray-100">
              {new Intl.NumberFormat("en-US", {
                style: "currency",
                currency: "USD",
                maximumFractionDigits: 0,
              }).format(consolidatedValue)}
            </span>
            {editMode && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteRow();
                }}
                className="text-white hover:text-white"
                aria-label={`Delete ${biz.name}`}
              >
                <TrashIcon />
              </button>
            )}
          </div>
        </div>
      </div>
      {expanded && hasChildren && (
        <div className="bg-gray-950/40 px-4 py-2 pl-12">
          {children_.length > 0 && (
            <div className="mb-2">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                Owned accounts
              </div>
              <div className="divide-y divide-gray-800/60 overflow-hidden rounded-md border border-gray-800/80">
                {children_.map((c) => (
                  <div
                    key={c.id}
                    onClick={() => onClickChild(c)}
                    className="flex cursor-pointer items-center justify-between px-3 py-1.5 hover:bg-gray-800/60"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-[13px] text-gray-100">{c.name}</div>
                      <div className="truncate text-[11px] text-gray-500">{c.category}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[13px] text-gray-100">
                        {new Intl.NumberFormat("en-US", {
                          style: "currency",
                          currency: "USD",
                          maximumFractionDigits: 0,
                        }).format(Number(c.value))}
                      </span>
                      {editMode && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteChild(c);
                          }}
                          className="text-white hover:text-white"
                          aria-label={`Delete ${c.name}`}
                        >
                          <TrashIcon />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {childLiabilities.length > 0 && (
            <div className="mb-2">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                Owed liabilities
              </div>
              <div className="divide-y divide-gray-800/60 overflow-hidden rounded-md border border-gray-800/80">
                {childLiabilities.map((l) => (
                  <div
                    key={l.id}
                    onClick={() => onClickChildLiability(l)}
                    className="flex cursor-pointer items-center justify-between px-3 py-1.5 hover:bg-gray-800/60"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-[13px] text-gray-100">{l.name}</div>
                    </div>
                    <span className="text-[13px] text-red-400">
                      (
                      {new Intl.NumberFormat("en-US", {
                        style: "currency",
                        currency: "USD",
                        maximumFractionDigits: 0,
                      }).format(currentYearBalance(l))}
                      )
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {ownedIncomes.length > 0 && (
            <div className="relative">
              <button
                type="button"
                onClick={onToggleIncomesPopover}
                className="inline-flex items-center gap-1 rounded-full border border-emerald-700/50 bg-emerald-900/30 px-2.5 py-0.5 text-[11px] font-medium text-emerald-300 hover:bg-emerald-900/50"
                aria-expanded={incomesPopoverOpen}
                aria-haspopup="dialog"
              >
                Incomes · {ownedIncomes.length}
              </button>
              {incomesPopoverOpen && (
                <div
                  role="dialog"
                  className="absolute left-0 z-20 mt-1 w-56 overflow-hidden rounded-md border border-gray-700 bg-gray-900 shadow-lg"
                >
                  <ul className="max-h-56 overflow-y-auto py-1">
                    {ownedIncomes.map((i) => (
                      <li
                        key={i.id}
                        className="px-3 py-1.5 text-[12px] text-gray-200"
                      >
                        {i.name}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
