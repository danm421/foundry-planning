// src/components/balance-sheet-table-view.tsx
"use client";

import { useRef, useState, useEffect, type ReactNode } from "react";
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
import type { AccountRow, LiabilityRow } from "./balance-sheet-view";

interface BalanceSheetTableViewProps {
  clientId: string;
  accounts: AccountRow[];
  liabilities: LiabilityRow[];
  notesReceivable?: NoteReceivable[];
  entities: EntityOption[];
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

  // Mirror the in-estate predicate used in balance-sheet-view.tsx: a business
  // entity is in-estate when its `entity_owners` rows sum to ≥99.99% (or
  // owners are absent — legacy fixtures pre-date the join table).
  const inEstateFlatValuedEntityIds = new Set<string>();
  for (const e of props.entities) {
    const value = Number(e.value ?? "0");
    if (value <= 0) continue;
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

  // Term policies (cash_value = 0) excluded — same rule as balance-sheet-view.
  const isVisibleInNetWorth = (a: AccountRow) =>
    !(a.category === "life_insurance" && Number(a.value) === 0);

  const visibleAccounts = accounts.filter(
    (a) => a.category !== "notes_receivable" && isVisibleInNetWorth(a),
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

  // In-estate business entities with positive flat value — surface as rows in Business.
  const inEstateBusinessEntityRows = entities.filter(
    (e) =>
      e.entityType &&
      BUSINESS_ENTITY_TYPES.has(e.entityType) &&
      Number(e.value ?? "0") > 0 &&
      ctx.inEstateFlatValuedEntityIds.has(e.id),
  );

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
          router.push(withScenario(`/clients/${clientId}/client-data/insurance?policy=${a.id}`));
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
    const value = Number(e.value ?? "0");
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
      sublabel: "edit in Family",
      split,
      onClick: () => router.push(withScenario(`/clients/${clientId}/client-data/family`)),
      deletable: false,
    };
  }

  // Build one ordered list of (category, rows) for rendering.
  const categoryGroups: { category: AccountCategory; rows: AssetTableRow[]; subtotal: ColumnSplit }[] = [];
  for (const cat of CATEGORY_ORDER) {
    const rows: AssetTableRow[] = [];
    for (const a of accountsByCategory[cat]) rows.push(accountToTableRow(a));
    if (cat === "business") {
      for (const e of inEstateBusinessEntityRows) rows.push(entityFlatToTableRow(e));
    }
    if (cat === "notes_receivable") {
      for (const n of notesReceivable) rows.push(noteToTableRow(n));
    }
    if (rows.length === 0) continue;
    const subtotal = rows.reduce<ColumnSplit>((s, r) => addSplits(s, r.split), emptySplit());
    categoryGroups.push({ category: cat, rows, subtotal });
  }

  const totalAssets = categoryGroups.reduce<ColumnSplit>(
    (s, g) => addSplits(s, g.subtotal),
    emptySplit(),
  );

  return (
    <div className="space-y-4">
      {/* Header strip with actions */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">Balance Sheet</h2>
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

      {/* Table shell — filled in subsequent tasks */}
      <div className="overflow-x-auto rounded-lg border border-hair bg-card">
        <table className="min-w-[760px] w-full text-sm">
          <thead>
            <tr className="border-b border-hair">
              <th className="sticky left-0 z-10 bg-card px-4 py-2 text-left text-[11px] font-medium uppercase tracking-wider text-ink-3">
                Asset / Liability
              </th>
              <th className="px-4 py-2 text-right text-[11px] font-medium uppercase tracking-wider text-ink-3">
                {cooperLabel}
              </th>
              {hasSpouse && (
                <>
                  <th className="px-4 py-2 text-right text-[11px] font-medium uppercase tracking-wider text-ink-3">
                    {sarahLabel}
                  </th>
                  <th className="px-4 py-2 text-right text-[11px] font-medium uppercase tracking-wider text-ink-3">
                    Joint
                  </th>
                </>
              )}
              <th className="px-4 py-2 text-right text-[11px] font-medium uppercase tracking-wider text-ink-3">
                Total
              </th>
              <th className="px-4 py-2 text-right text-[11px] font-medium uppercase tracking-wider text-accent-ink bg-accent/8">
                Out of Estate
              </th>
              <th className="w-8 px-2 py-2" aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {categoryGroups.length === 0 && liabilities.length === 0 && (
              <tr>
                <td
                  colSpan={hasSpouse ? 7 : 5}
                  className="px-4 py-8 text-center text-sm text-ink-3"
                >
                  No assets or liabilities yet. Use the actions above to get started.
                </td>
              </tr>
            )}
            {categoryGroups.map((g) => (
              <CategorySection
                key={g.category}
                label={CATEGORY_LABELS[g.category]}
                rows={g.rows}
                subtotal={g.subtotal}
                hasSpouse={hasSpouse}
                edit={edit}
              />
            ))}
            {categoryGroups.length > 0 && (
              <TotalRow
                label="Total Assets"
                split={totalAssets}
                hasSpouse={hasSpouse}
                emphasis="grand"
              />
            )}
          </tbody>
        </table>
      </div>

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

function CategorySection({
  label,
  rows,
  subtotal,
  hasSpouse,
  edit,
}: {
  label: string;
  rows: AssetTableRow[];
  subtotal: ColumnSplit;
  hasSpouse: boolean;
  edit: boolean;
}) {
  const colSpan = hasSpouse ? 7 : 5;
  return (
    <>
      <tr className="bg-card-2">
        <td
          colSpan={colSpan}
          className="sticky left-0 z-[1] bg-card-2 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-ink-2"
        >
          {label}
        </td>
      </tr>
      {rows.map((r) => (
        <AssetRow key={r.key} row={r} hasSpouse={hasSpouse} edit={edit} />
      ))}
      <SubtotalRow split={subtotal} hasSpouse={hasSpouse} />
    </>
  );
}

function AssetRow({
  row,
  hasSpouse,
  edit,
}: {
  row: AssetTableRow;
  hasSpouse: boolean;
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
      className={`border-t border-hair ${clickable ? "cursor-pointer hover:bg-card-hover" : ""}`}
    >
      <td className="sticky left-0 z-[1] bg-card px-4 py-2 shadow-[inset_-8px_0_8px_-8px_rgba(0,0,0,0.4)]">
        <div className="text-sm font-medium text-ink">{row.label}</div>
        {row.sublabel && <div className="text-xs text-ink-3">{row.sublabel}</div>}
      </td>
      <Cell value={row.split.cooper} />
      {hasSpouse && <Cell value={row.split.sarah} />}
      {hasSpouse && <Cell value={row.split.joint} />}
      <Cell value={row.split.cooper + row.split.sarah + row.split.joint} />
      <Cell value={row.split.ooe} accent />
      <td className="w-8 px-2 py-2 text-right">
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

function SubtotalRow({ split, hasSpouse }: { split: ColumnSplit; hasSpouse: boolean }) {
  return (
    <tr className="border-t border-hair bg-card-2/60">
      <td className="sticky left-0 z-[1] bg-card-2/60 px-4 py-2 text-xs font-medium uppercase tracking-wider text-ink-3">
        Subtotal
      </td>
      <Cell value={split.cooper} variant="subtotal" />
      {hasSpouse && <Cell value={split.sarah} variant="subtotal" />}
      {hasSpouse && <Cell value={split.joint} variant="subtotal" />}
      <Cell value={split.cooper + split.sarah + split.joint} variant="subtotal" />
      <Cell value={split.ooe} accent variant="subtotal" />
      <td className="w-8 px-2 py-2" />
    </tr>
  );
}

function TotalRow({
  label,
  split,
  hasSpouse,
  emphasis,
  signColor,
}: {
  label: string;
  split: ColumnSplit;
  hasSpouse: boolean;
  emphasis: "grand" | "net-worth";
  signColor?: boolean;
}) {
  const borderClass =
    emphasis === "grand"
      ? "border-t-2 border-hair-2 bg-card-2"
      : "border-t-2 border-hair-2 bg-card-2";
  const labelClass =
    emphasis === "grand"
      ? "text-sm font-semibold uppercase tracking-wider text-ink"
      : "text-sm font-bold uppercase tracking-wider text-ink";
  const valueVariant = emphasis === "grand" ? "total" : "net-worth";
  const inEstateTotal = split.cooper + split.sarah + split.joint;
  return (
    <tr className={borderClass}>
      <td className={`sticky left-0 z-[1] ${borderClass.includes("bg-card-2") ? "bg-card-2" : ""} px-4 py-3 ${labelClass}`}>
        {label}
      </td>
      <Cell value={split.cooper} variant={valueVariant} signColor={signColor} />
      {hasSpouse && <Cell value={split.sarah} variant={valueVariant} signColor={signColor} />}
      {hasSpouse && <Cell value={split.joint} variant={valueVariant} signColor={signColor} />}
      <Cell value={inEstateTotal} variant={valueVariant} signColor={signColor} />
      {emphasis === "net-worth" ? (
        <td className="bg-accent/8 px-4 py-3" aria-hidden="true" />
      ) : (
        <Cell value={split.ooe} accent variant={valueVariant} />
      )}
      <td className="w-8 px-2 py-3" />
    </tr>
  );
}

function Cell({
  value,
  accent,
  variant = "row",
  signColor,
}: {
  value: number;
  accent?: boolean;
  variant?: "row" | "subtotal" | "total" | "net-worth";
  signColor?: boolean;
}) {
  const isZero = Math.abs(value) < 0.5;
  let cls = "px-4 py-2 text-right text-sm tabular-nums";
  if (variant === "subtotal") cls += " font-medium text-ink-2";
  else if (variant === "total") cls += " font-semibold text-ink";
  else if (variant === "net-worth") cls += " text-base font-bold";
  else cls += " text-ink";
  if (accent) cls += " bg-accent/8 text-accent-ink";
  if (signColor && !isZero) cls += value >= 0 ? " text-good" : " text-crit";
  return <td className={cls}>{isZero ? <span className="text-ink-4">—</span> : fmt(value)}</td>;
}
