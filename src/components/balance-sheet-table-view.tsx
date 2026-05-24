// src/components/balance-sheet-table-view.tsx
"use client";

import { useRef, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useScenarioWriter } from "@/hooks/use-scenario-writer";
import { useScenarioPreservingHref } from "@/hooks/use-scenario-preserving-href";
import AddAccountDialog from "./add-account-dialog";
import AddLiabilityDialog from "./add-liability-dialog";
import ConfirmDeleteDialog from "./confirm-delete-dialog";
import {
  AccountFormInitial,
  EntityOption,
  CategoryDefaults,
  ModelPortfolioOption,
} from "./forms/add-account-form";
import { type AssetClassOption } from "./forms/asset-mix-tab";
import { LiabilityFormInitial } from "./forms/add-liability-form";
import type { NoteReceivableFormInitial } from "./forms/add-note-receivable-form";
import { computeAmortizationSchedule, calcOriginalBalance } from "@/lib/loan-math";
import type { OwnerNames } from "@/lib/owner-labels";
import type { ClientMilestones } from "@/lib/milestones";
import {
  buildNoteReceivableSchedule,
  type NoteReceivable,
} from "@/engine/notes-receivable";
import {
  attributeToColumns,
  attributeEntityFlatValue,
  emptySplit,
  addSplits,
  type AttributionCtx,
  type ColumnSplit,
} from "@/lib/balance-sheet/attribute";
import { LEGACY_FM_CLIENT, LEGACY_FM_SPOUSE, type AccountOwner } from "@/engine/ownership";
import type { AccountRow, LiabilityRow } from "./balance-sheet-view";

export interface ExternalBeneficiaryOption {
  id: string;
  name: string;
}

interface BalanceSheetTableViewProps {
  clientId: string;
  accounts: AccountRow[];
  liabilities: LiabilityRow[];
  notesReceivable?: NoteReceivable[];
  entities: EntityOption[];
  externalBeneficiaries?: ExternalBeneficiaryOption[];
  familyMembers?: { id: string; role: "client" | "spouse" | "child" | "other"; firstName: string }[];
  categoryDefaults: CategoryDefaults;
  modelPortfolios?: ModelPortfolioOption[];
  ownerNames: OwnerNames;
  assetClasses?: AssetClassOption[];
  portfolioAllocationsMap?: Record<string, { assetClassId: string; weight: number }[]>;
  categoryDefaultSources?: Record<
    string,
    { source: string; portfolioId?: string; portfolioName?: string; blendedReturn?: number }
  >;
  milestones?: ClientMilestones;
  resolvedInflationRate?: number;
}

type AccountCategory = AccountRow["category"];

const CATEGORY_LABELS: Record<AccountCategory, string> = {
  taxable: "Taxable",
  cash: "Cash",
  retirement: "Retirement",
  real_estate: "Real Estate",
  business: "Business",
  life_insurance: "Life Insurance",
  notes_receivable: "Notes Receivable",
};

const CATEGORY_ORDER: AccountCategory[] = [
  "cash",
  "taxable",
  "retirement",
  "real_estate",
  "business",
  "life_insurance",
  "notes_receivable",
];

const ADDABLE_CATEGORIES: AccountCategory[] = [
  "taxable",
  "cash",
  "retirement",
  "real_estate",
  "notes_receivable",
];

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
      <path
        fillRule="evenodd"
        d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
      <path
        fillRule="evenodd"
        d="M7.293 4.293a1 1 0 011.414 0l5 5a1 1 0 010 1.414l-5 5a1 1 0 11-1.414-1.414L11.586 10 7.293 5.707a1 1 0 010-1.414z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function ChevronUp() {
  return (
    <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
      <path
        fillRule="evenodd"
        d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z"
        clipRule="evenodd"
      />
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
    growthRate: a.growthRate,
    rmdEnabled: a.rmdEnabled ?? null,
    priorYearEndValue: a.priorYearEndValue ?? null,
    ownerEntityId: a.ownerEntityId ?? null,
    growthSource: a.growthSource,
    modelPortfolioId: a.modelPortfolioId ?? null,
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

function noteBalanceAtYear(n: NoteReceivable, year: number): number {
  const schedule = buildNoteReceivableSchedule(n);
  const row = schedule.find((r) => r.year === year);
  if (row) return row.endingBalance;
  if (year < (schedule[0]?.year ?? n.startYear)) {
    return n.asOfBalance ?? n.faceValue;
  }
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
  };
}

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
  const lastRow = schedule[schedule.length - 1];
  return lastRow ? lastRow.endingBalance : 0;
}

const BUSINESS_ENTITY_TYPES = new Set(["llc", "s_corp", "c_corp", "partnership", "other"]);

const ENTITY_TYPE_LABEL: Record<string, string> = {
  trust: "Trust",
  llc: "LLC",
  s_corp: "S-Corp",
  c_corp: "C-Corp",
  partnership: "Partnership",
  foundation: "Foundation",
  other: "Entity",
};

function buildCtx(props: {
  familyMembers?: BalanceSheetTableViewProps["familyMembers"];
  entities: EntityOption[];
  accounts: AccountRow[];
  liabilities: LiabilityRow[];
  notesReceivable: NoteReceivable[];
}): AttributionCtx {
  const rolesByFamilyMemberId = new Map<string, "client" | "spouse" | "child" | "other">();
  let clientFamilyMemberId: string | null = null;
  let spouseFamilyMemberId: string | null = null;
  for (const fm of props.familyMembers ?? []) {
    rolesByFamilyMemberId.set(fm.id, fm.role);
    if (fm.role === "client") clientFamilyMemberId = fm.id;
    if (fm.role === "spouse") spouseFamilyMemberId = fm.id;
  }

  // A business entity is in-estate when its `entity_owners` rows sum to
  // ≥99.99% (or owners are absent — legacy fixtures pre-date the join table).
  // Membership here drives both (a) rule-3 hold-back of underlying accounts/
  // liabilities so they don't double-count on category rows and (b) which
  // entities surface as a single rolled-up row in Business. Note: no value
  // gate — a household-owned business with $0 flat value but funded internal
  // accounts must still hold those accounts back from their category rows so
  // they can be rolled into the entity row instead of leaking to OOE.
  const inEstateFlatValuedEntityIds = new Set<string>();
  for (const e of props.entities) {
    if (!e.entityType || !BUSINESS_ENTITY_TYPES.has(e.entityType)) continue;
    if (e.owners == null) {
      inEstateFlatValuedEntityIds.add(e.id);
      continue;
    }
    const sum = e.owners.reduce((s, o) => s + (o.percent ?? 0), 0);
    if (sum >= 0.9999) inEstateFlatValuedEntityIds.add(e.id);
  }

  const titlingByItemId = new Map<string, "jtwros" | "community_property" | null>();
  for (const a of props.accounts) {
    if (a.titlingType) titlingByItemId.set(a.id, a.titlingType);
  }
  // Liabilities don't carry titlingType on the prop today. They follow rule 1
  // by default; if/when joint titling is added to liabilities the prop wires
  // up here automatically.

  return {
    clientFamilyMemberId,
    spouseFamilyMemberId,
    rolesByFamilyMemberId,
    inEstateFlatValuedEntityIds,
    titlingByItemId,
  };
}

interface AssetTableRow {
  key: string;
  kind: "account" | "note" | "business-entity";
  label: string;
  sublabel?: string;
  split: ColumnSplit;
  onClick?: () => void;
  onDelete?: () => void;
  deletable: boolean;
}

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
        className="inline-flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-on hover:bg-accent-deep"
      >
        + Add Asset <ChevronDown />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-md border border-hair bg-card-2 shadow-lg">
          {ADDABLE_CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => {
                setOpen(false);
                onPick(cat);
              }}
              className="block w-full px-3 py-2 text-left text-sm text-ink hover:bg-card-hover"
            >
              {CATEGORY_LABELS[cat]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function BalanceSheetTableView({
  clientId,
  accounts,
  liabilities,
  notesReceivable = [],
  entities,
  externalBeneficiaries = [],
  familyMembers,
  categoryDefaults,
  modelPortfolios,
  ownerNames,
  assetClasses,
  portfolioAllocationsMap,
  categoryDefaultSources,
  milestones,
  resolvedInflationRate,
}: BalanceSheetTableViewProps) {
  const router = useRouter();
  const writer = useScenarioWriter(clientId);
  const withScenario = useScenarioPreservingHref();

  const [edit, setEdit] = useState(false);
  const [addCategory, setAddCategory] = useState<AccountCategory | null>(null);
  const [editingAccount, setEditingAccount] = useState<AccountRow | null>(null);
  const [deletingAccount, setDeletingAccount] = useState<AccountRow | null>(null);
  const [editingLiability, setEditingLiability] = useState<LiabilityRow | null>(null);
  const [deletingLiability, setDeletingLiability] = useState<LiabilityRow | null>(null);
  const [editingNote, setEditingNote] = useState<NoteReceivable | null>(null);
  const [deletingNote, setDeletingNote] = useState<NoteReceivable | null>(null);

  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<"standard" | "by-owner">("standard");
  const [collapsedOwners, setCollapsedOwners] = useState<Set<string>>(new Set());
  const toggleOwner = (id: string) =>
    setCollapsedOwners((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleCategory = (key: string) =>
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const toggleSection = (key: string) =>
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const realEstateAccounts = accounts
    .filter((a) => a.category === "real_estate")
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

  const hasSpouse = !!ownerNames.spouseName;
  const cooperLabel = ownerNames.clientName.split(" ")[0];
  const sarahLabel = hasSpouse ? ownerNames.spouseName!.split(" ")[0] : null;

  const ctx = buildCtx({
    familyMembers,
    entities,
    accounts,
    liabilities,
    notesReceivable,
  });

  const entityMap = Object.fromEntries(entities.map((e) => [e.id, e]));

  // Zero-value assets are hidden on this report.
  const visibleAccounts = accounts.filter(
    (a) => a.category !== "notes_receivable" && Number(a.value) > 0,
  );

  // Bucket accounts by category.
  const accountsByCategory: Record<AccountCategory, AccountRow[]> = {
    cash: [],
    taxable: [],
    retirement: [],
    real_estate: [],
    business: [],
    life_insurance: [],
    notes_receivable: [],
  };
  for (const a of visibleAccounts) accountsByCategory[a.category].push(a);

  // Per-entity sum of internally-held account dollars (rule 3 holds these back
  // from their category rows; we roll them into the single Business entity row
  // here so the household-owned business shows its true total — flat valuation
  // plus the assets it owns). Skips notes_receivable (sourced elsewhere) and
  // $0 accounts (already excluded from `visibleAccounts`).
  const entityHoldingsById = new Map<string, number>();
  for (const a of visibleAccounts) {
    for (const owner of a.owners ?? []) {
      if (owner.kind !== "entity") continue;
      if (!ctx.inEstateFlatValuedEntityIds.has(owner.entityId)) continue;
      const contribution = Number(a.value) * owner.percent;
      entityHoldingsById.set(
        owner.entityId,
        (entityHoldingsById.get(owner.entityId) ?? 0) + contribution,
      );
    }
  }

  // In-estate business entities — surface as rows in Business when flat
  // valuation plus rolled-up entity-owned account holdings is positive.
  const inEstateBusinessEntityRows = entities.filter((e) => {
    if (!e.entityType || !BUSINESS_ENTITY_TYPES.has(e.entityType)) return false;
    if (!ctx.inEstateFlatValuedEntityIds.has(e.id)) return false;
    const flat = Number(e.value ?? "0");
    const holdings = entityHoldingsById.get(e.id) ?? 0;
    return flat + holdings > 0;
  });

  // Notes receivable display year: prior year-end, matching the existing logic.
  const noteDisplayYear = new Date().getFullYear() - 1;

  function accountToTableRow(a: AccountRow): AssetTableRow {
    const value = Number(a.value);
    const split = attributeToColumns(
      { id: a.id, value, owners: a.owners ?? [] },
      ctx,
    );
    const fractionNote =
      split.representedPct < 0.9999
        ? `(${Math.round(split.representedPct * 100)}% of ${fmt(value)})`
        : undefined;
    // Add entity-name suffix if the account is wholly OOE-entity-owned.
    let labelSuffix = "";
    const soleEntity = a.owners?.length === 1 && a.owners[0].kind === "entity"
      ? a.owners[0]
      : null;
    if (soleEntity && !ctx.inEstateFlatValuedEntityIds.has(soleEntity.entityId)) {
      const ent = entityMap[soleEntity.entityId];
      if (ent) labelSuffix = ` @ ${ent.name}`;
    }
    return {
      key: a.id,
      kind: "account",
      label: a.name + labelSuffix,
      sublabel: fractionNote,
      split,
      onClick: () => {
        if (edit) return;
        if (a.category === "life_insurance") {
          router.push(withScenario(`/clients/${clientId}/details/insurance?policy=${a.id}`));
          return;
        }
        setEditingAccount(a);
      },
      onDelete: () => setDeletingAccount(a),
      deletable: !a.isDefaultChecking,
    };
  }

  function noteToTableRow(n: NoteReceivable): AssetTableRow {
    const value = noteBalanceAtYear(n, noteDisplayYear);
    const split = attributeToColumns(
      { id: n.id, value, owners: n.owners ?? [] },
      ctx,
    );
    return {
      key: n.id,
      kind: "note",
      label: n.name,
      sublabel: n.linkedTrustEntityId
        ? `→ ${entityMap[n.linkedTrustEntityId]?.name ?? "Trust"}`
        : undefined,
      split,
      onClick: () => {
        if (edit) return;
        setEditingNote(n);
      },
      onDelete: () => setDeletingNote(n),
      deletable: true,
    };
  }

  function entityFlatToTableRow(e: EntityOption): AssetTableRow {
    const flat = Number(e.value ?? "0");
    const holdings = entityHoldingsById.get(e.id) ?? 0;
    const value = flat + holdings;
    const split = attributeEntityFlatValue(
      {
        id: e.id,
        value,
        owners: e.owners?.map((o) => ({
          familyMemberId: o.familyMemberId,
          percent: o.percent,
        })),
      },
      ctx,
    );
    return {
      key: `flat-${e.id}`,
      kind: "business-entity",
      label: e.name,
      sublabel: holdings > 0 && flat > 0
        ? `${fmt(flat)} valuation + ${fmt(holdings)} in accounts`
        : "edit in Family",
      split,
      onClick: () => router.push(withScenario(`/clients/${clientId}/details/family`)),
      deletable: false,
    };
  }

  const ZERO_EPSILON = 0.5;
  const hasInEstateValue = (s: ColumnSplit) =>
    Math.abs(s.cooper) + Math.abs(s.sarah) + Math.abs(s.joint) > ZERO_EPSILON;
  const hasOoeValue = (s: ColumnSplit) => Math.abs(s.ooe) > ZERO_EPSILON;

  // Build one ordered list of (category, rows) split into in-estate and OOE.
  type CategoryGroup = {
    category: AccountCategory;
    inEstateRows: AssetTableRow[];
    ooeRows: AssetTableRow[];
    inEstateSubtotal: ColumnSplit;
    ooeSubtotal: ColumnSplit;
  };
  const categoryGroups: CategoryGroup[] = [];
  for (const cat of CATEGORY_ORDER) {
    const rows: AssetTableRow[] = [];
    for (const a of accountsByCategory[cat]) rows.push(accountToTableRow(a));
    if (cat === "business") {
      for (const e of inEstateBusinessEntityRows) rows.push(entityFlatToTableRow(e));
    }
    if (cat === "notes_receivable") {
      for (const n of notesReceivable) {
        if (noteBalanceAtYear(n, noteDisplayYear) > 0) rows.push(noteToTableRow(n));
      }
    }
    const inEstateRows = rows.filter((r) => hasInEstateValue(r.split));
    const ooeRows = rows.filter((r) => hasOoeValue(r.split));
    if (inEstateRows.length === 0 && ooeRows.length === 0) continue;
    const inEstateSubtotal = inEstateRows.reduce<ColumnSplit>(
      (s, r) => addSplits(s, r.split),
      emptySplit(),
    );
    const ooeSubtotal = ooeRows.reduce<ColumnSplit>(
      (s, r) => addSplits(s, r.split),
      emptySplit(),
    );
    categoryGroups.push({ category: cat, inEstateRows, ooeRows, inEstateSubtotal, ooeSubtotal });
  }

  const totalAssets = categoryGroups.reduce<ColumnSplit>(
    (s, g) => addSplits(s, addSplits(g.inEstateSubtotal, g.ooeSubtotal)),
    emptySplit(),
  );

  function liabilityToTableRow(l: LiabilityRow): AssetTableRow {
    const balance = currentYearBalance(l);
    const split = attributeToColumns(
      { id: l.id, value: balance, owners: l.owners ?? [] },
      ctx,
    );
    return {
      key: l.id,
      kind: "account", // re-uses AssetRow styling; the row label tells the story
      label: l.name,
      sublabel:
        Number(l.interestRate) > 0
          ? `${(Number(l.interestRate) * 100).toFixed(2)}% interest`
          : undefined,
      split,
      onClick: () => {
        if (edit) return;
        setEditingLiability(l);
      },
      onDelete: () => setDeletingLiability(l),
      deletable: true,
    };
  }

  const allLiabilityRows = liabilities.map(liabilityToTableRow);
  const inEstateLiabilityRows = allLiabilityRows.filter((r) => hasInEstateValue(r.split));
  const ooeLiabilityRows = allLiabilityRows.filter((r) => hasOoeValue(r.split));
  const totalLiabilities = allLiabilityRows.reduce<ColumnSplit>(
    (s, r) => addSplits(s, r.split),
    emptySplit(),
  );
  const inEstateTotalLiabilities = inEstateLiabilityRows.reduce<ColumnSplit>(
    (s, r) => addSplits(s, r.split),
    emptySplit(),
  );
  const ooeTotalLiabilities = ooeLiabilityRows.reduce<ColumnSplit>(
    (s, r) => addSplits(s, r.split),
    emptySplit(),
  );

  const netWorth: ColumnSplit = {
    cooper: totalAssets.cooper - totalLiabilities.cooper,
    sarah: totalAssets.sarah - totalLiabilities.sarah,
    joint: totalAssets.joint - totalLiabilities.joint,
    ooe: totalAssets.ooe - totalLiabilities.ooe,
    representedPct: 1,
  };

  const ooeAssetCategoryGroups = categoryGroups.filter((g) => g.ooeRows.length > 0);
  const hasOoeContent = ooeAssetCategoryGroups.length > 0 || ooeLiabilityRows.length > 0;

  // ── By-owner view: one card per family member / OOE entity / external
  // beneficiary that has any attributable assets or liabilities. Each item
  // contributes `value × ownership%` to its owner. In-estate flat-valued
  // businesses bypass the per-account walk (their underlying rows are scaled
  // out by the engine when family share is 100%) and instead surface their
  // single flat value under each family-member owner — matching how the
  // standard view treats them on the Business row.
  type OwnerKind = "family_member" | "entity" | "external_beneficiary";
  interface OwnerRowItem {
    key: string;
    label: string;
    sublabel?: string;
    value: number;
    onClick?: () => void;
    onDelete?: () => void;
    deletable: boolean;
  }
  interface OwnerGroup {
    key: string;
    kind: OwnerKind;
    name: string;
    typeLabel: string;
    assetRows: OwnerRowItem[];
    liabilityRows: OwnerRowItem[];
    assetTotal: number;
    liabilityTotal: number;
    netWorth: number;
  }

  const fmDisplayName = (id: string): string => {
    if (id === LEGACY_FM_CLIENT) return cooperLabel;
    if (id === LEGACY_FM_SPOUSE) return sarahLabel ?? "Spouse";
    const fm = familyMembers?.find((f) => f.id === id);
    if (!fm) return "Family member";
    if (fm.role === "client") return cooperLabel;
    if (fm.role === "spouse" && sarahLabel) return sarahLabel;
    return fm.firstName;
  };

  const fmRoleLabel = (id: string): string => {
    if (id === LEGACY_FM_CLIENT) return "Client";
    if (id === LEGACY_FM_SPOUSE) return "Spouse";
    const fm = familyMembers?.find((f) => f.id === id);
    if (!fm) return "Family";
    return fm.role === "client"
      ? "Client"
      : fm.role === "spouse"
        ? "Spouse"
        : fm.role === "child"
          ? "Child"
          : "Family";
  };

  const ownerGroupsMap = new Map<string, OwnerGroup>();
  const getOrCreateOwner = (
    key: string,
    kind: OwnerKind,
    name: string,
    typeLabel: string,
  ): OwnerGroup => {
    let g = ownerGroupsMap.get(key);
    if (!g) {
      g = {
        key,
        kind,
        name,
        typeLabel,
        assetRows: [],
        liabilityRows: [],
        assetTotal: 0,
        liabilityTotal: 0,
        netWorth: 0,
      };
      ownerGroupsMap.set(key, g);
    }
    return g;
  };

  const resolveOwner = (
    owner: AccountOwner,
  ): { group: OwnerGroup; ownerKey: string } | null => {
    if (owner.kind === "family_member") {
      const ownerKey = `fm:${owner.familyMemberId}`;
      return {
        ownerKey,
        group: getOrCreateOwner(
          ownerKey,
          "family_member",
          fmDisplayName(owner.familyMemberId),
          fmRoleLabel(owner.familyMemberId),
        ),
      };
    }
    if (owner.kind === "entity") {
      if (ctx.inEstateFlatValuedEntityIds.has(owner.entityId)) return null;
      const ent = entityMap[owner.entityId];
      const ownerKey = `ent:${owner.entityId}`;
      const typeLabel =
        (ent?.entityType && ENTITY_TYPE_LABEL[ent.entityType]) ?? ENTITY_TYPE_LABEL.other;
      return {
        ownerKey,
        group: getOrCreateOwner(ownerKey, "entity", ent?.name ?? "Entity", typeLabel),
      };
    }
    // external_beneficiary
    const eb = externalBeneficiaries.find((b) => b.id === owner.externalBeneficiaryId);
    const ownerKey = `eb:${owner.externalBeneficiaryId}`;
    return {
      ownerKey,
      group: getOrCreateOwner(
        ownerKey,
        "external_beneficiary",
        eb?.name ?? "External beneficiary",
        "External",
      ),
    };
  };

  for (const a of visibleAccounts) {
    const total = Number(a.value);
    for (const owner of a.owners ?? []) {
      const slot = resolveOwner(owner);
      if (!slot) continue;
      const value = total * owner.percent;
      if (Math.abs(value) <= ZERO_EPSILON) continue;
      slot.group.assetRows.push({
        key: `${slot.ownerKey}-acct-${a.id}`,
        label: a.name,
        sublabel:
          owner.percent < 0.9999
            ? `${Math.round(owner.percent * 100)}% share of ${fmt(total)}`
            : undefined,
        value,
        onClick: () => {
          if (edit) return;
          if (a.category === "life_insurance") {
            router.push(
              withScenario(`/clients/${clientId}/details/insurance?policy=${a.id}`),
            );
            return;
          }
          setEditingAccount(a);
        },
        onDelete: () => setDeletingAccount(a),
        deletable: !a.isDefaultChecking,
      });
    }
  }

  for (const n of notesReceivable) {
    const total = noteBalanceAtYear(n, noteDisplayYear);
    if (total <= 0) continue;
    for (const owner of n.owners ?? []) {
      const slot = resolveOwner(owner);
      if (!slot) continue;
      const value = total * owner.percent;
      if (Math.abs(value) <= ZERO_EPSILON) continue;
      slot.group.assetRows.push({
        key: `${slot.ownerKey}-note-${n.id}`,
        label: n.name,
        sublabel:
          owner.percent < 0.9999
            ? `${Math.round(owner.percent * 100)}% share of ${fmt(total)}`
            : undefined,
        value,
        onClick: () => {
          if (!edit) setEditingNote(n);
        },
        onDelete: () => setDeletingNote(n),
        deletable: true,
      });
    }
  }

  for (const l of liabilities) {
    const balance = currentYearBalance(l);
    for (const owner of l.owners ?? []) {
      const slot = resolveOwner(owner);
      if (!slot) continue;
      const value = balance * owner.percent;
      if (Math.abs(value) <= ZERO_EPSILON) continue;
      slot.group.liabilityRows.push({
        key: `${slot.ownerKey}-liab-${l.id}`,
        label: l.name,
        sublabel:
          Number(l.interestRate) > 0
            ? `${(Number(l.interestRate) * 100).toFixed(2)}% interest`
            : undefined,
        value,
        onClick: () => {
          if (!edit) setEditingLiability(l);
        },
        onDelete: () => setDeletingLiability(l),
        deletable: true,
      });
    }
  }

  // In-estate flat-valued businesses → attribute their total value (flat
  // valuation + rolled-up entity-owned account holdings) to each family-member
  // owner. Entity-kind owners of the business (e.g. a trust holding part of
  // an LLC) intentionally skipped here; the trust gets the share via the
  // underlying accounts (rule 4) when the business isn't wholly in-estate.
  for (const e of entities) {
    if (!ctx.inEstateFlatValuedEntityIds.has(e.id)) continue;
    const flat = Number(e.value ?? "0");
    const holdings = entityHoldingsById.get(e.id) ?? 0;
    const total = flat + holdings;
    if (total <= 0) continue;
    if (!e.owners || e.owners.length === 0) {
      // Legacy: missing entity_owners → treat as 100% client.
      const ownerKey = `fm:${LEGACY_FM_CLIENT}`;
      const group = getOrCreateOwner(
        ownerKey,
        "family_member",
        cooperLabel,
        "Client",
      );
      group.assetRows.push({
        key: `${ownerKey}-ent-${e.id}`,
        label: e.name,
        sublabel: "Business value",
        value: total,
        onClick: () => router.push(withScenario(`/clients/${clientId}/details/family`)),
        deletable: false,
      });
      continue;
    }
    for (const owner of e.owners) {
      const value = total * owner.percent;
      if (Math.abs(value) <= ZERO_EPSILON) continue;
      const ownerKey = `fm:${owner.familyMemberId}`;
      const group = getOrCreateOwner(
        ownerKey,
        "family_member",
        fmDisplayName(owner.familyMemberId),
        fmRoleLabel(owner.familyMemberId),
      );
      group.assetRows.push({
        key: `${ownerKey}-ent-${e.id}`,
        label: e.name,
        sublabel:
          owner.percent < 0.9999
            ? `${Math.round(owner.percent * 100)}% of business`
            : "Business value",
        value,
        onClick: () => router.push(withScenario(`/clients/${clientId}/details/family`)),
        deletable: false,
      });
    }
  }

  for (const g of ownerGroupsMap.values()) {
    g.assetTotal = g.assetRows.reduce((s, r) => s + r.value, 0);
    g.liabilityTotal = g.liabilityRows.reduce((s, r) => s + r.value, 0);
    g.netWorth = g.assetTotal - g.liabilityTotal;
  }

  const ownerGroups = [...ownerGroupsMap.values()]
    .filter((g) => g.assetRows.length > 0 || g.liabilityRows.length > 0)
    .sort((a, b) => {
      const kindOrder = (g: OwnerGroup) =>
        g.kind === "family_member" ? 0 : g.kind === "entity" ? 1 : 2;
      if (kindOrder(a) !== kindOrder(b)) return kindOrder(a) - kindOrder(b);
      return b.netWorth - a.netWorth;
    });

  return (
    <div className="space-y-4">
      {/* Header strip with actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-ink">Balance Sheet</h2>
          <div
            role="tablist"
            aria-label="Balance sheet view"
            className="inline-flex overflow-hidden rounded-md border border-hair-2 bg-card text-xs"
          >
            <button
              role="tab"
              aria-selected={viewMode === "standard"}
              onClick={() => setViewMode("standard")}
              className={`px-3 py-1 font-medium transition-colors ${
                viewMode === "standard"
                  ? "bg-accent/15 text-accent-ink"
                  : "text-ink-3 hover:bg-card-hover hover:text-ink-2"
              }`}
            >
              Standard
            </button>
            <button
              role="tab"
              aria-selected={viewMode === "by-owner"}
              onClick={() => setViewMode("by-owner")}
              className={`border-l border-hair-2 px-3 py-1 font-medium transition-colors ${
                viewMode === "by-owner"
                  ? "bg-accent/15 text-accent-ink"
                  : "text-ink-3 hover:bg-card-hover hover:text-ink-2"
              }`}
            >
              By Owner
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {(accounts.length > 0 || liabilities.length > 0 || notesReceivable.length > 0) && (
            <button
              onClick={() => setEdit((v) => !v)}
              className={`rounded-md border px-3 py-1 text-xs font-medium ${
                edit
                  ? "border-accent bg-accent/15 text-accent-ink"
                  : "border-hair-2 bg-card text-ink-2 hover:bg-card-hover"
              }`}
            >
              {edit ? "Done" : "Edit"}
            </button>
          )}
          <AddAssetMenu onPick={(cat) => setAddCategory(cat)} />
          <AddLiabilityDialog
            clientId={clientId}
            realEstateAccounts={realEstateAccounts}
            entities={entities}
            familyMembers={familyMembers}
            clientFirstName={cooperLabel}
            spouseFirstName={sarahLabel ?? undefined}
          />
        </div>
      </div>

      {viewMode === "standard" && (
        <>
      {/* Main balance sheet (in-estate) */}
      <div className="overflow-x-auto">
        <table className="min-w-[520px] w-full text-[13px] border-collapse">
          <thead>
            <tr className="border-b border-hair-2">
              <th className="sticky left-0 z-10 bg-paper px-2 py-1 text-left text-[10px] font-medium uppercase tracking-wider text-ink-3">
                Category / Account
              </th>
              <th className="px-2 py-1 text-right text-[10px] font-medium uppercase tracking-wider text-ink-3">
                {cooperLabel}
              </th>
              {hasSpouse && (
                <>
                  <th className="px-2 py-1 text-right text-[10px] font-medium uppercase tracking-wider text-ink-3">
                    {sarahLabel}
                  </th>
                  <th className="px-2 py-1 text-right text-[10px] font-medium uppercase tracking-wider text-ink-3">
                    Joint
                  </th>
                </>
              )}
              <th className="px-2 py-1 text-right text-[10px] font-medium uppercase tracking-wider text-ink-3">
                Total
              </th>
              <th className="w-6 px-1 py-1" aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {categoryGroups.length === 0 && allLiabilityRows.length === 0 && (
              <tr>
                <td
                  colSpan={hasSpouse ? 6 : 4}
                  className="px-2 py-6 text-center text-[13px] text-ink-3"
                >
                  No assets or liabilities yet. Use the actions above to get started.
                </td>
              </tr>
            )}
            {categoryGroups.some((g) => g.inEstateRows.length > 0) && (
              <SectionBanner
                label="Assets"
                tone="asset"
                collapsed={collapsedSections.has("assets")}
                onToggle={() => toggleSection("assets")}
                hasSpouse={hasSpouse}
              />
            )}
            {!collapsedSections.has("assets") &&
              categoryGroups.map((g) =>
                g.inEstateRows.length > 0 ? (
                  <CategorySection
                    key={g.category}
                    label={CATEGORY_LABELS[g.category]}
                    rows={g.inEstateRows}
                    subtotal={g.inEstateSubtotal}
                    hasSpouse={hasSpouse}
                    edit={edit}
                    tone="asset"
                    collapsed={collapsedCategories.has(`asset-${g.category}`)}
                    onToggle={() => toggleCategory(`asset-${g.category}`)}
                  />
                ) : null,
              )}
            {categoryGroups.some((g) => g.inEstateRows.length > 0) && (
              <TotalRow
                label="Total Assets"
                split={{ ...totalAssets, ooe: 0 }}
                hasSpouse={hasSpouse}
                emphasis="grand"
                tone="asset"
              />
            )}
            {inEstateLiabilityRows.length > 0 && (
              <>
                <SectionBanner
                  label="Liabilities"
                  tone="liability"
                  collapsed={collapsedSections.has("liabilities")}
                  onToggle={() => toggleSection("liabilities")}
                  hasSpouse={hasSpouse}
                />
                {!collapsedSections.has("liabilities") && (
                  <LiabilityCategoryRows
                    rows={inEstateLiabilityRows}
                    subtotal={inEstateTotalLiabilities}
                    hasSpouse={hasSpouse}
                    edit={edit}
                    collapsedCategories={collapsedCategories}
                    toggleCategory={toggleCategory}
                  />
                )}
                <TotalRow
                  label="Total Liabilities"
                  split={{ ...inEstateTotalLiabilities, ooe: 0 }}
                  hasSpouse={hasSpouse}
                  emphasis="grand"
                  tone="liability"
                />
              </>
            )}
            {(categoryGroups.length > 0 || allLiabilityRows.length > 0) && (
              <TotalRow
                label="Net Worth"
                split={{ ...netWorth, ooe: 0 }}
                hasSpouse={hasSpouse}
                emphasis="net-worth"
                signColor
              />
            )}
          </tbody>
        </table>
      </div>

      {/* Out-of-estate assets — separate table below net worth */}
      {hasOoeContent && (
        <div className="overflow-x-auto">
          <table className="min-w-[360px] w-full text-[13px] border-collapse">
            <thead>
              <tr className="border-b border-hair-2">
                <th className="sticky left-0 z-10 bg-paper px-2 py-1 text-left text-[10px] font-medium uppercase tracking-wider text-ink-3">
                  Category / Account
                </th>
                <th className="px-2 py-1 text-right text-[10px] font-medium uppercase tracking-wider text-ink-3">
                  Value
                </th>
                <th className="w-6 px-1 py-1" aria-hidden="true" />
              </tr>
            </thead>
            <tbody>
              {ooeAssetCategoryGroups.length > 0 && (
                <OoeSectionBanner
                  label="Out of Estate Assets"
                  tone="asset"
                  collapsed={collapsedSections.has("ooe-assets")}
                  onToggle={() => toggleSection("ooe-assets")}
                />
              )}
              {!collapsedSections.has("ooe-assets") &&
                ooeAssetCategoryGroups.map((g) => (
                  <OoeCategorySection
                    key={g.category}
                    label={CATEGORY_LABELS[g.category]}
                    rows={g.ooeRows}
                    subtotal={g.ooeSubtotal.ooe}
                    edit={edit}
                    collapsed={collapsedCategories.has(`ooe-${g.category}`)}
                    onToggle={() => toggleCategory(`ooe-${g.category}`)}
                  />
                ))}
              {ooeAssetCategoryGroups.length > 0 && (
                <OoeTotalRow
                  label="Total OOE Assets"
                  value={totalAssets.ooe}
                  emphasis="grand"
                  tone="asset"
                />
              )}
              {ooeLiabilityRows.length > 0 && (
                <>
                  <OoeSectionBanner
                    label="Out of Estate Liabilities"
                    tone="liability"
                    collapsed={collapsedSections.has("ooe-liabilities")}
                    onToggle={() => toggleSection("ooe-liabilities")}
                  />
                  {!collapsedSections.has("ooe-liabilities") &&
                    ooeLiabilityRows.map((r) => (
                      <OoeLiabilityRowRender key={r.key} row={r} edit={edit} />
                    ))}
                  <OoeTotalRow
                    label="Total OOE Liabilities"
                    value={ooeTotalLiabilities.ooe}
                    emphasis="grand"
                    tone="liability"
                  />
                </>
              )}
              <OoeTotalRow
                label="Net OOE"
                value={totalAssets.ooe - ooeTotalLiabilities.ooe}
                emphasis="net-worth"
                signColor
              />
            </tbody>
          </table>
        </div>
      )}
        </>
      )}

      {viewMode === "by-owner" && (
        <div className="space-y-3">
          {ownerGroups.length === 0 && (
            <div className="rounded-md border border-hair-2 bg-card p-6 text-center text-[13px] text-ink-3">
              No owners with attributable assets or liabilities yet.
            </div>
          )}
          {ownerGroups.map((g) => (
            <OwnerCard
              key={g.key}
              group={g}
              collapsed={collapsedOwners.has(g.key)}
              onToggle={() => toggleOwner(g.key)}
              edit={edit}
            />
          ))}
        </div>
      )}

      {/* Dialogs */}
      <AddAccountDialog
        clientId={clientId}
        category={addCategory ?? undefined}
        label={addCategory ? CATEGORY_LABELS[addCategory] : undefined}
        entities={entities}
        familyMembers={familyMembers}
        categoryDefaults={categoryDefaults}
        modelPortfolios={modelPortfolios}
        ownerNames={ownerNames}
        assetClasses={assetClasses}
        portfolioAllocationsMap={portfolioAllocationsMap}
        categoryDefaultSources={categoryDefaultSources}
        milestones={milestones}
        clientFirstName={cooperLabel}
        spouseFirstName={sarahLabel ?? undefined}
        existingAccountNames={accounts.map((a) => a.name)}
        resolvedInflationRate={resolvedInflationRate}
        open={addCategory !== null}
        onOpenChange={(o) => !o && setAddCategory(null)}
      />

      <AddAccountDialog
        clientId={clientId}
        entities={entities}
        familyMembers={familyMembers}
        categoryDefaults={categoryDefaults}
        modelPortfolios={modelPortfolios}
        ownerNames={ownerNames}
        assetClasses={assetClasses}
        categoryDefaultSources={categoryDefaultSources}
        portfolioAllocationsMap={portfolioAllocationsMap}
        milestones={milestones}
        clientFirstName={cooperLabel}
        spouseFirstName={sarahLabel ?? undefined}
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
        familyMembers={familyMembers}
        clientFirstName={cooperLabel}
        spouseFirstName={sarahLabel ?? undefined}
        open={!!editingLiability}
        onOpenChange={(o) => !o && setEditingLiability(null)}
        editing={editingLiability ? liabilityToInitial(editingLiability) : undefined}
        onRequestDelete={() => {
          if (editingLiability) setDeletingLiability(editingLiability);
        }}
      />

      <AddAccountDialog
        clientId={clientId}
        entities={entities}
        familyMembers={familyMembers}
        categoryDefaults={categoryDefaults}
        modelPortfolios={modelPortfolios}
        ownerNames={ownerNames}
        assetClasses={assetClasses}
        categoryDefaultSources={categoryDefaultSources}
        portfolioAllocationsMap={portfolioAllocationsMap}
        milestones={milestones}
        clientFirstName={cooperLabel}
        spouseFirstName={sarahLabel ?? undefined}
        resolvedInflationRate={resolvedInflationRate}
        open={!!editingNote}
        onOpenChange={(o) => !o && setEditingNote(null)}
        editingNote={editingNote ? noteToInitial(editingNote) : undefined}
        onRequestDelete={() => {
          if (editingNote) setDeletingNote(editingNote);
        }}
      />

      <ConfirmDeleteDialog
        open={!!deletingAccount}
        title="Delete Account"
        message={
          deletingAccount
            ? `Delete "${deletingAccount.name}"? This will also remove any savings rules or withdrawal strategies linked to it.`
            : ""
        }
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

type Tone = "asset" | "liability";

const toneTextClass = (tone: Tone) =>
  tone === "asset" ? "text-accent-ink" : "text-crit";

function SectionBanner({
  label,
  tone,
  collapsed,
  onToggle,
  hasSpouse,
}: {
  label: string;
  tone: Tone;
  collapsed: boolean;
  onToggle: () => void;
  hasSpouse: boolean;
}) {
  const colSpan = hasSpouse ? 6 : 4;
  return (
    <tr
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
      tabIndex={0}
      role="button"
      aria-expanded={!collapsed}
      className="cursor-pointer hover:bg-card-hover focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
    >
      <td
        colSpan={colSpan}
        className={`sticky left-0 z-[1] bg-paper px-2 py-1 text-[11px] font-bold uppercase tracking-wider ${toneTextClass(tone)}`}
      >
        <span className="inline-flex items-center gap-1.5">
          {collapsed ? <ChevronRight /> : <ChevronUp />}
          {label}
        </span>
      </td>
    </tr>
  );
}

function CategorySection({
  label,
  rows,
  subtotal,
  hasSpouse,
  edit,
  tone,
  collapsed,
  onToggle,
}: {
  label: string;
  rows: AssetTableRow[];
  subtotal: ColumnSplit;
  hasSpouse: boolean;
  edit: boolean;
  tone: Tone;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const inEstateTotal = subtotal.cooper + subtotal.sarah + subtotal.joint;
  return (
    <>
      <tr
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
        tabIndex={0}
        role="button"
        aria-expanded={!collapsed}
        className="cursor-pointer border-t border-hair hover:bg-card-hover focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      >
        <td
          className={`sticky left-0 z-[1] bg-paper px-2 py-1 text-[12px] font-semibold ${toneTextClass(tone)}`}
        >
          <span className="inline-flex items-center gap-1.5 pl-2">
            {collapsed ? <ChevronRight /> : <ChevronDown />}
            {label}
          </span>
        </td>
        <SubtotalCell value={subtotal.cooper} tone={tone} />
        {hasSpouse && <SubtotalCell value={subtotal.sarah} tone={tone} />}
        {hasSpouse && <SubtotalCell value={subtotal.joint} tone={tone} />}
        <SubtotalCell value={inEstateTotal} tone={tone} />
        <td className="w-6 px-1 py-1" />
      </tr>
      {!collapsed &&
        rows.map((r) => (
          <AssetRow key={r.key} row={r} hasSpouse={hasSpouse} edit={edit} tone={tone} />
        ))}
    </>
  );
}

function AssetRow({
  row,
  hasSpouse,
  edit,
  tone,
}: {
  row: AssetTableRow;
  hasSpouse: boolean;
  edit: boolean;
  tone: Tone;
}) {
  const clickable = !!row.onClick && !edit;
  return (
    <tr
      onClick={clickable ? row.onClick : undefined}
      onKeyDown={(e) => {
        if (!clickable) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          row.onClick?.();
        }
      }}
      tabIndex={clickable ? 0 : -1}
      role={clickable ? "button" : undefined}
      className={
        clickable
          ? "cursor-pointer hover:bg-card-hover focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
          : undefined
      }
    >
      <td className="sticky left-0 z-[1] bg-paper px-2 py-1 pl-10">
        <div className="text-[13px] text-ink-2">{row.label}</div>
        {row.sublabel && <div className="text-[11px] text-ink-3">{row.sublabel}</div>}
      </td>
      <ValueCell value={row.split.cooper} tone={tone} />
      {hasSpouse && <ValueCell value={row.split.sarah} tone={tone} />}
      {hasSpouse && <ValueCell value={row.split.joint} tone={tone} />}
      <ValueCell value={row.split.cooper + row.split.sarah + row.split.joint} tone={tone} />
      <td className="w-6 px-1 py-1 text-right">
        {edit && row.deletable && row.onDelete && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              row.onDelete?.();
            }}
            className="text-ink hover:text-crit"
            aria-label={`Delete ${row.label}`}
          >
            <TrashIcon />
          </button>
        )}
      </td>
    </tr>
  );
}

function LiabilityCategoryRows({
  rows,
  subtotal,
  hasSpouse,
  edit,
  collapsedCategories,
  toggleCategory,
}: {
  rows: AssetTableRow[];
  subtotal: ColumnSplit;
  hasSpouse: boolean;
  edit: boolean;
  collapsedCategories: Set<string>;
  toggleCategory: (key: string) => void;
}) {
  // Liabilities aren't bucketed by sub-category today — render under a single
  // "Liabilities" pseudo-category so the chevron + inline subtotal pattern is
  // consistent with the asset side.
  const key = "liability-all";
  const collapsed = collapsedCategories.has(key);
  const inEstateTotal = subtotal.cooper + subtotal.sarah + subtotal.joint;
  return (
    <>
      <tr
        onClick={() => toggleCategory(key)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggleCategory(key);
          }
        }}
        tabIndex={0}
        role="button"
        aria-expanded={!collapsed}
        className="cursor-pointer border-t border-hair hover:bg-card-hover focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      >
        <td className="sticky left-0 z-[1] bg-paper px-2 py-1 text-[12px] font-semibold text-crit">
          <span className="inline-flex items-center gap-1.5 pl-2">
            {collapsed ? <ChevronRight /> : <ChevronDown />}
            Debts & Loans
          </span>
        </td>
        <SubtotalCell value={subtotal.cooper} tone="liability" />
        {hasSpouse && <SubtotalCell value={subtotal.sarah} tone="liability" />}
        {hasSpouse && <SubtotalCell value={subtotal.joint} tone="liability" />}
        <SubtotalCell value={inEstateTotal} tone="liability" />
        <td className="w-6 px-1 py-1" />
      </tr>
      {!collapsed &&
        rows.map((r) => (
          <AssetRow key={r.key} row={r} hasSpouse={hasSpouse} edit={edit} tone="liability" />
        ))}
    </>
  );
}

function ValueCell({ value, tone }: { value: number; tone: Tone }) {
  const isZero = Math.abs(value) < 0.5;
  let cls = "px-2 py-1 text-right text-[13px] tabular-nums";
  if (isZero) cls += " text-ink-4";
  else cls += tone === "asset" ? " text-ink" : " text-crit";
  return <td className={cls}>{fmt(isZero ? 0 : value)}</td>;
}

function SubtotalCell({ value, tone }: { value: number; tone: Tone }) {
  const isZero = Math.abs(value) < 0.5;
  let cls = "px-2 py-1 text-right text-[13px] font-semibold tabular-nums";
  if (isZero) cls += " text-ink-4";
  else cls += tone === "asset" ? " text-ink" : " text-crit";
  return <td className={cls}>{fmt(isZero ? 0 : value)}</td>;
}

function TotalRow({
  label,
  split,
  hasSpouse,
  emphasis,
  signColor,
  tone,
}: {
  label: string;
  split: ColumnSplit;
  hasSpouse: boolean;
  emphasis: "grand" | "net-worth";
  signColor?: boolean;
  tone?: Tone;
}) {
  const labelToneClass = tone ? toneTextClass(tone) : "text-ink";
  const labelClass =
    emphasis === "grand"
      ? `text-[12px] font-bold uppercase tracking-wider ${labelToneClass}`
      : "text-[13px] font-bold uppercase tracking-wider text-ink";
  const valueVariant = emphasis === "grand" ? "total" : "net-worth";
  const inEstateTotal = split.cooper + split.sarah + split.joint;
  return (
    <tr className="border-t-2 border-hair-2">
      <td className={`sticky left-0 z-[1] bg-paper px-2 py-1 ${labelClass}`}>{label}</td>
      <TotalCell value={split.cooper} variant={valueVariant} signColor={signColor} tone={tone} />
      {hasSpouse && (
        <TotalCell value={split.sarah} variant={valueVariant} signColor={signColor} tone={tone} />
      )}
      {hasSpouse && (
        <TotalCell value={split.joint} variant={valueVariant} signColor={signColor} tone={tone} />
      )}
      <TotalCell value={inEstateTotal} variant={valueVariant} signColor={signColor} tone={tone} />
      <td className="w-6 px-1 py-1" />
    </tr>
  );
}

function TotalCell({
  value,
  variant,
  signColor,
  tone,
}: {
  value: number;
  variant: "total" | "net-worth";
  signColor?: boolean;
  tone?: Tone;
}) {
  const isZero = Math.abs(value) < 0.5;
  let cls = "px-2 py-1 text-right tabular-nums";
  if (variant === "net-worth") cls += " text-[14px] font-bold text-ink";
  else cls += ` text-[13px] font-bold ${tone ? toneTextClass(tone) : "text-ink"}`;
  if (isZero) cls += " text-ink-4";
  if (signColor && !isZero) cls += value >= 0 ? " text-good" : " text-crit";
  return <td className={cls}>{fmt(isZero ? 0 : value)}</td>;
}

function OoeSectionBanner({
  label,
  tone,
  collapsed,
  onToggle,
}: {
  label: string;
  tone: Tone;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <tr
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
      tabIndex={0}
      role="button"
      aria-expanded={!collapsed}
      className="cursor-pointer hover:bg-card-hover focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
    >
      <td
        colSpan={3}
        className={`sticky left-0 z-[1] bg-paper px-2 py-1 text-[11px] font-bold uppercase tracking-wider ${toneTextClass(tone)}`}
      >
        <span className="inline-flex items-center gap-1.5">
          {collapsed ? <ChevronRight /> : <ChevronUp />}
          {label}
        </span>
      </td>
    </tr>
  );
}

function OoeCategorySection({
  label,
  rows,
  subtotal,
  edit,
  collapsed,
  onToggle,
}: {
  label: string;
  rows: AssetTableRow[];
  subtotal: number;
  edit: boolean;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
        tabIndex={0}
        role="button"
        aria-expanded={!collapsed}
        className="cursor-pointer border-t border-hair hover:bg-card-hover focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      >
        <td className="sticky left-0 z-[1] bg-paper px-2 py-1 text-[12px] font-semibold text-accent-ink">
          <span className="inline-flex items-center gap-1.5 pl-2">
            {collapsed ? <ChevronRight /> : <ChevronDown />}
            {label}
          </span>
        </td>
        <SubtotalCell value={subtotal} tone="asset" />
        <td className="w-6 px-1 py-1" />
      </tr>
      {!collapsed && rows.map((r) => <OoeAssetRow key={r.key} row={r} edit={edit} />)}
    </>
  );
}

function OoeAssetRow({ row, edit }: { row: AssetTableRow; edit: boolean }) {
  const clickable = !!row.onClick && !edit;
  return (
    <tr
      onClick={clickable ? row.onClick : undefined}
      onKeyDown={(e) => {
        if (!clickable) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          row.onClick?.();
        }
      }}
      tabIndex={clickable ? 0 : -1}
      role={clickable ? "button" : undefined}
      className={
        clickable
          ? "cursor-pointer hover:bg-card-hover focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
          : undefined
      }
    >
      <td className="sticky left-0 z-[1] bg-paper px-2 py-1 pl-10">
        <div className="text-[13px] text-ink-2">{row.label}</div>
        {row.sublabel && <div className="text-[11px] text-ink-3">{row.sublabel}</div>}
      </td>
      <ValueCell value={row.split.ooe} tone="asset" />
      <td className="w-6 px-1 py-1 text-right">
        {edit && row.deletable && row.onDelete && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              row.onDelete?.();
            }}
            className="text-ink hover:text-crit"
            aria-label={`Delete ${row.label}`}
          >
            <TrashIcon />
          </button>
        )}
      </td>
    </tr>
  );
}

function OoeLiabilityRowRender({ row, edit }: { row: AssetTableRow; edit: boolean }) {
  const clickable = !!row.onClick && !edit;
  return (
    <tr
      onClick={clickable ? row.onClick : undefined}
      onKeyDown={(e) => {
        if (!clickable) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          row.onClick?.();
        }
      }}
      tabIndex={clickable ? 0 : -1}
      role={clickable ? "button" : undefined}
      className={
        clickable
          ? "cursor-pointer hover:bg-card-hover focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
          : undefined
      }
    >
      <td className="sticky left-0 z-[1] bg-paper px-2 py-1 pl-10">
        <div className="text-[13px] text-ink-2">{row.label}</div>
        {row.sublabel && <div className="text-[11px] text-ink-3">{row.sublabel}</div>}
      </td>
      <ValueCell value={row.split.ooe} tone="liability" />
      <td className="w-6 px-1 py-1 text-right">
        {edit && row.onDelete && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              row.onDelete?.();
            }}
            className="text-ink hover:text-crit"
            aria-label={`Delete ${row.label}`}
          >
            <TrashIcon />
          </button>
        )}
      </td>
    </tr>
  );
}

function OoeTotalRow({
  label,
  value,
  emphasis,
  signColor,
  tone,
}: {
  label: string;
  value: number;
  emphasis: "grand" | "net-worth";
  signColor?: boolean;
  tone?: Tone;
}) {
  const labelToneClass = tone ? toneTextClass(tone) : "text-ink";
  const labelClass =
    emphasis === "grand"
      ? `text-[12px] font-bold uppercase tracking-wider ${labelToneClass}`
      : "text-[13px] font-bold uppercase tracking-wider text-ink";
  const valueVariant = emphasis === "grand" ? "total" : "net-worth";
  return (
    <tr className="border-t-2 border-hair-2">
      <td className={`sticky left-0 z-[1] bg-paper px-2 py-1 ${labelClass}`}>{label}</td>
      <TotalCell value={value} variant={valueVariant} signColor={signColor} tone={tone} />
      <td className="w-6 px-1 py-1" />
    </tr>
  );
}

interface OwnerCardRowItem {
  key: string;
  label: string;
  sublabel?: string;
  value: number;
  onClick?: () => void;
  onDelete?: () => void;
  deletable: boolean;
}

interface OwnerCardGroup {
  key: string;
  kind: "family_member" | "entity" | "external_beneficiary";
  name: string;
  typeLabel: string;
  assetRows: OwnerCardRowItem[];
  liabilityRows: OwnerCardRowItem[];
  assetTotal: number;
  liabilityTotal: number;
  netWorth: number;
}

function OwnerCard({
  group,
  collapsed,
  onToggle,
  edit,
}: {
  group: OwnerCardGroup;
  collapsed: boolean;
  onToggle: () => void;
  edit: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-md border border-hair-2 bg-card">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-card-hover focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
      >
        <span className="inline-flex items-center gap-2">
          {collapsed ? <ChevronRight /> : <ChevronDown />}
          <span className="text-[13px] font-semibold text-ink">{group.name}</span>
          <span className="rounded bg-card-2 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-3">
            {group.typeLabel}
          </span>
        </span>
        <span className="inline-flex items-baseline gap-3">
          <span className="text-[10px] uppercase tracking-wider text-ink-3">Assets</span>
          <span className="text-[13px] font-semibold tabular-nums text-ink">
            {fmt(group.assetTotal)}
          </span>
        </span>
      </button>
      {!collapsed && (
        <div className="border-t border-hair">
          <table className="w-full text-[13px] border-collapse">
            <tbody>
              {group.assetRows.length > 0 && (
                <tr>
                  <td className="bg-paper/40 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-accent-ink">
                    Assets
                  </td>
                  <td className="bg-paper/40 px-3 py-1 text-right text-[11px] font-semibold tabular-nums text-ink-2">
                    {fmt(group.assetTotal)}
                  </td>
                  <td className="w-6 bg-paper/40 px-1 py-1" />
                </tr>
              )}
              {group.assetRows.map((r) => (
                <OwnerCardItemRow key={r.key} row={r} tone="asset" edit={edit} />
              ))}
              {group.liabilityRows.length > 0 && (
                <tr>
                  <td className="bg-paper/40 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-crit">
                    Liabilities
                  </td>
                  <td className="bg-paper/40 px-3 py-1 text-right text-[11px] font-semibold tabular-nums text-ink-2">
                    {fmt(group.liabilityTotal)}
                  </td>
                  <td className="w-6 bg-paper/40 px-1 py-1" />
                </tr>
              )}
              {group.liabilityRows.map((r) => (
                <OwnerCardItemRow key={r.key} row={r} tone="liability" edit={edit} />
              ))}
              <tr className="border-t-2 border-hair-2">
                <td className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-ink">
                  Net Worth
                </td>
                <td
                  className={`px-3 py-1.5 text-right text-[13px] font-bold tabular-nums ${
                    group.netWorth >= 0 ? "text-good" : "text-crit"
                  }`}
                >
                  {fmt(group.netWorth)}
                </td>
                <td className="w-6 px-1 py-1" />
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function OwnerCardItemRow({
  row,
  tone,
  edit,
}: {
  row: OwnerCardRowItem;
  tone: Tone;
  edit: boolean;
}) {
  const clickable = !!row.onClick && !edit;
  return (
    <tr
      onClick={clickable ? row.onClick : undefined}
      onKeyDown={(e) => {
        if (!clickable) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          row.onClick?.();
        }
      }}
      tabIndex={clickable ? 0 : -1}
      role={clickable ? "button" : undefined}
      className={
        clickable
          ? "cursor-pointer hover:bg-card-hover focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
          : undefined
      }
    >
      <td className="px-3 py-1 pl-8">
        <div className="text-[13px] text-ink-2">{row.label}</div>
        {row.sublabel && <div className="text-[11px] text-ink-3">{row.sublabel}</div>}
      </td>
      <td
        className={`px-3 py-1 text-right text-[13px] tabular-nums ${
          tone === "asset" ? "text-ink" : "text-crit"
        }`}
      >
        {fmt(row.value)}
      </td>
      <td className="w-6 px-1 py-1 text-right">
        {edit && row.deletable && row.onDelete && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              row.onDelete?.();
            }}
            className="text-ink hover:text-crit"
            aria-label={`Delete ${row.label}`}
          >
            <TrashIcon />
          </button>
        )}
      </td>
    </tr>
  );
}

