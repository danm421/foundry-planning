"use client";

import { useRef, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import AddAccountDialog from "./add-account-dialog";
import AddLiabilityDialog from "./add-liability-dialog";
import ConfirmDeleteDialog from "./confirm-delete-dialog";
import { AccountFormInitial, EntityOption, CategoryDefaults, ModelPortfolioOption } from "./forms/add-account-form";
import { type AssetClassOption } from "./forms/asset-mix-tab";
import { LiabilityFormInitial } from "./forms/add-liability-form";
import { computeAmortizationSchedule, calcOriginalBalance } from "@/lib/loan-math";
import { individualOwnerLabel, type OwnerNames } from "@/lib/owner-labels";
import type { ClientMilestones } from "@/lib/milestones";

type AccountCategory = "taxable" | "cash" | "retirement" | "real_estate" | "business" | "life_insurance";

export interface AccountRow {
  id: string;
  name: string;
  category: AccountCategory;
  subType: string;
  owner: string;
  value: string;
  basis: string;
  growthRate: string | null;
  rmdEnabled?: boolean | null;
  ownerEntityId?: string | null;
  growthSource?: string;
  modelPortfolioId?: string | null;
  turnoverPct?: string | null;
  overridePctOi?: string | null;
  overridePctLtCg?: string | null;
  overridePctQdiv?: string | null;
  overridePctTaxExempt?: string | null;
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
}

interface BalanceSheetViewProps {
  clientId: string;
  accounts: AccountRow[];
  liabilities: LiabilityRow[];
  entities: EntityOption[];
  categoryDefaults: CategoryDefaults;
  modelPortfolios?: ModelPortfolioOption[];
  ownerNames: OwnerNames;
  assetClasses?: AssetClassOption[];
  portfolioAllocationsMap?: Record<string, { assetClassId: string; weight: number }[]>;
  categoryDefaultSources?: Record<string, { source: string; portfolioId?: string; portfolioName?: string; blendedReturn?: number }>;
  milestones?: ClientMilestones;
}

const CATEGORY_LABELS: Record<AccountCategory, string> = {
  taxable: "Taxable",
  cash: "Cash",
  retirement: "Retirement",
  real_estate: "Real Estate",
  business: "Business",
  life_insurance: "Life Insurance",
};

const CATEGORY_ORDER: AccountCategory[] = [
  "taxable",
  "cash",
  "retirement",
  "real_estate",
  "business",
  "life_insurance",
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

function accountToInitial(a: AccountRow): AccountFormInitial {
  return {
    id: a.id,
    name: a.name,
    category: a.category,
    subType: a.subType,
    owner: a.owner,
    value: a.value,
    basis: a.basis,
    growthRate: a.growthRate,
    rmdEnabled: a.rmdEnabled ?? null,
    ownerEntityId: a.ownerEntityId ?? null,
    growthSource: a.growthSource,
    modelPortfolioId: a.modelPortfolioId ?? null,
    turnoverPct: a.turnoverPct ?? undefined,
    overridePctOi: a.overridePctOi ?? null,
    overridePctLtCg: a.overridePctLtCg ?? null,
    overridePctQdiv: a.overridePctQdiv ?? null,
    overridePctTaxExempt: a.overridePctTaxExempt ?? null,
  };
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
  };
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
        className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
      >
        + Add Asset <ChevronDown />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-md border border-gray-700 bg-gray-900 shadow-lg">
          {CATEGORY_ORDER.map((cat) => (
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
  entities,
  categoryDefaults,
  modelPortfolios,
  ownerNames,
  assetClasses,
  portfolioAllocationsMap,
  categoryDefaultSources,
  milestones,
}: BalanceSheetViewProps) {
  const router = useRouter();

  const [assetsEdit, setAssetsEdit] = useState(false);
  const [liabilitiesEdit, setLiabilitiesEdit] = useState(false);

  // Controlled Add Asset dialog (after category pick)
  const [addCategory, setAddCategory] = useState<AccountCategory | null>(null);

  const [editingAccount, setEditingAccount] = useState<AccountRow | null>(null);
  const [deletingAccount, setDeletingAccount] = useState<AccountRow | null>(null);

  const [editingLiability, setEditingLiability] = useState<LiabilityRow | null>(null);
  const [deletingLiability, setDeletingLiability] = useState<LiabilityRow | null>(null);

  const entityMap = Object.fromEntries(entities.map((e) => [e.id, e]));
  const inEstate = accounts.filter((a) => !a.ownerEntityId);
  const outOfEstate = accounts.filter((a) => a.ownerEntityId);

  const inEstateByCategory: Record<AccountCategory, AccountRow[]> = {
    taxable: [],
    cash: [],
    retirement: [],
    real_estate: [],
    business: [],
    life_insurance: [],
  };
  for (const a of inEstate) inEstateByCategory[a.category].push(a);

  const outByEntity = new Map<string, AccountRow[]>();
  for (const a of outOfEstate) {
    const key = a.ownerEntityId!;
    const arr = outByEntity.get(key) ?? [];
    arr.push(a);
    outByEntity.set(key, arr);
  }

  const BUSINESS_ENTITY_TYPES = new Set(["llc", "s_corp", "c_corp", "partnership", "other"]);
  const businessEntityRows = entities.filter(
    (e) => e.entityType && BUSINESS_ENTITY_TYPES.has(e.entityType) && Number(e.value ?? "0") > 0,
  );
  const businessEntityTotal = businessEntityRows.reduce(
    (s, e) => s + Number(e.value ?? "0"),
    0,
  );

  const totalInEstate = inEstate.reduce((s, a) => s + Number(a.value), 0);
  const totalOutOfEstate =
    outOfEstate.reduce((s, a) => s + Number(a.value), 0) + businessEntityTotal;
  const totalAssets = totalInEstate + totalOutOfEstate;
  const totalLiabilities = liabilities.reduce((s, l) => s + currentYearBalance(l), 0);
  const netWorth = totalInEstate - totalLiabilities;
  const realEstateAccounts = accounts
    .filter((a) => a.category === "real_estate")
    .map((a) => ({ id: a.id, name: a.name }));

  async function performAccountDelete(id: string) {
    const res = await fetch(`/api/clients/${clientId}/accounts/${id}`, { method: "DELETE" });
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
    const res = await fetch(`/api/clients/${clientId}/liabilities/${id}`, { method: "DELETE" });
    if (!res.ok && res.status !== 204) {
      const json = await res.json().catch(() => ({}));
      alert(json.error ?? "Failed to delete liability");
      return;
    }
    setDeletingLiability(null);
    setEditingLiability(null);
    router.refresh();
  }

  function ownerDisplay(a: AccountRow) {
    if (a.ownerEntityId && entityMap[a.ownerEntityId]) return entityMap[a.ownerEntityId].name;
    return individualOwnerLabel(a.owner as "client" | "spouse" | "joint", ownerNames);
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

      {/* Two columns */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Assets column */}
        <Panel
          title="Assets"
          totalLabel={`Total ${fmt(totalInEstate)}`}
          actions={
            <div className="flex items-center gap-2">
              {accounts.length > 0 && <EditToggle on={assetsEdit} onToggle={() => setAssetsEdit((v) => !v)} />}
              <AddAssetMenu onPick={(cat) => setAddCategory(cat)} />
            </div>
          }
        >
          {inEstate.length === 0 ? (
            <EmptyRow message="No assets yet. Click Add Asset to get started." />
          ) : (
            CATEGORY_ORDER.map((cat) => {
              const items = inEstateByCategory[cat];
              if (items.length === 0) return null;
              const subtotal = items.reduce((s, a) => s + Number(a.value), 0);
              return (
                <CategoryGroup key={cat} label={CATEGORY_LABELS[cat]} total={fmt(subtotal)}>
                  {items.map((a) => (
                    <Row
                      key={a.id}
                      onClick={() => !assetsEdit && setEditingAccount(a)}
                      editMode={assetsEdit}
                      onDelete={() => setDeletingAccount(a)}
                      label={a.name}
                      subLabel={`${ownerDisplay(a)} · ${growthDisplay(a)}`}
                      value={fmt(a.value)}
                    />
                  ))}
                </CategoryGroup>
              );
            })
          )}
        </Panel>

        {/* Liabilities column */}
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
                clientFirstName={ownerNames.clientName.split(" ")[0]}
                spouseFirstName={ownerNames.spouseName?.split(" ")[0]}
              />
            </div>
          }
        >
          {liabilities.length === 0 ? (
            <EmptyRow message="No liabilities yet." />
          ) : (
            <div className="overflow-hidden rounded-md border border-gray-700 bg-gray-900/60">
              <div className="divide-y divide-gray-800">
                {liabilities.map((l) => (
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
      </div>

      {/* Out of Estate */}
      {(outOfEstate.length > 0 || businessEntityRows.length > 0) && (
        <div className="rounded-lg border border-amber-900/40 bg-amber-950/10 p-4">
          <div className="mb-3 flex items-baseline justify-between">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wider text-amber-300">Out of Estate</h3>
              <p className="text-xs text-amber-200/60">
                Assets owned by trusts, LLCs, or other entities. Not included in the household net-worth calculation above.
              </p>
            </div>
            <span className="text-sm font-medium text-amber-200">{fmt(totalOutOfEstate)}</span>
          </div>

          <div className="space-y-3">
            {Array.from(outByEntity.entries()).map(([entityId, rows]) => {
              const subtotal = rows.reduce((s, a) => s + Number(a.value), 0);
              const entityName = entityMap[entityId]?.name ?? "Unknown entity";
              return (
                <div key={entityId} className="overflow-hidden rounded-md border border-amber-900/40 bg-gray-900/60">
                  <div className="flex items-center justify-between border-b border-amber-900/40 bg-amber-900/15 px-3 py-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-amber-200">
                      {entityName}
                    </span>
                    <span className="text-xs font-medium text-amber-200/80">{fmt(subtotal)}</span>
                  </div>
                  <div className="divide-y divide-gray-800">
                    {rows.map((a) => (
                      <div
                        key={a.id}
                        onClick={() => !assetsEdit && setEditingAccount(a)}
                        className="flex cursor-pointer items-center justify-between px-4 py-2 hover:bg-gray-800/60"
                      >
                        <div>
                          <div className="text-sm font-medium text-gray-100">{a.name}</div>
                          <div className="text-xs text-gray-500">
                            {CATEGORY_LABELS[a.category]} · {growthDisplay(a)}
                          </div>
                        </div>
                        <span className="text-sm font-medium text-gray-100">{fmt(a.value)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}

            {businessEntityRows.length > 0 && (
              <div className="overflow-hidden rounded-md border border-amber-900/40 bg-gray-900/60">
                <div className="flex items-center justify-between border-b border-amber-900/40 bg-amber-900/15 px-3 py-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-amber-200">
                    Business interests
                  </span>
                  <span className="text-xs font-medium text-amber-200/80">{fmt(businessEntityTotal)}</span>
                </div>
                <div className="divide-y divide-gray-800">
                  {businessEntityRows.map((e) => (
                    <a
                      key={e.id}
                      href={`/clients/${clientId}/client-data/family`}
                      className="flex items-center justify-between px-4 py-2 hover:bg-gray-800/60"
                    >
                      <div>
                        <div className="text-sm font-medium text-gray-100">{e.name}</div>
                        <div className="text-xs text-gray-500">
                          {ENTITY_TYPE_LABELS[e.entityType ?? "other"] ?? "Entity"} · edit in Family
                        </div>
                      </div>
                      <span className="text-sm font-medium text-gray-100">{fmt(Number(e.value ?? "0"))}</span>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Add dialog (controlled by AddAssetMenu) */}
      <AddAccountDialog
        clientId={clientId}
        category={addCategory ?? undefined}
        label={addCategory ? CATEGORY_LABELS[addCategory] : undefined}
        entities={entities}
        categoryDefaults={categoryDefaults}
        modelPortfolios={modelPortfolios}
        ownerNames={ownerNames}
        assetClasses={assetClasses}
        portfolioAllocationsMap={portfolioAllocationsMap}
        categoryDefaultSources={categoryDefaultSources}
        milestones={milestones}
        clientFirstName={ownerNames.clientName.split(" ")[0]}
        spouseFirstName={ownerNames.spouseName?.split(" ")[0]}
        existingAccountNames={accounts.map((a) => a.name)}
        open={addCategory !== null}
        onOpenChange={(o) => !o && setAddCategory(null)}
      />

      {/* Edit dialogs */}
      <AddAccountDialog
        clientId={clientId}
        entities={entities}
        categoryDefaults={categoryDefaults}
        modelPortfolios={modelPortfolios}
        ownerNames={ownerNames}
        assetClasses={assetClasses}
        categoryDefaultSources={categoryDefaultSources}
        portfolioAllocationsMap={portfolioAllocationsMap}
        milestones={milestones}
        clientFirstName={ownerNames.clientName.split(" ")[0]}
        spouseFirstName={ownerNames.spouseName?.split(" ")[0]}
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
        clientFirstName={ownerNames.clientName.split(" ")[0]}
        spouseFirstName={ownerNames.spouseName?.split(" ")[0]}
        open={!!editingLiability}
        onOpenChange={(o) => !o && setEditingLiability(null)}
        editing={editingLiability ? liabilityToInitial(editingLiability) : undefined}
        onRequestDelete={() => {
          if (editingLiability) setDeletingLiability(editingLiability);
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
      <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500">{label}</p>
      <p className={`mt-1 text-lg font-bold ${accent}`}>{value}</p>
      {subtitle && <p className="text-[11px] text-gray-500">{subtitle}</p>}
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
    <div className="overflow-hidden rounded-lg border border-gray-800 bg-gray-900/30">
      <div className="flex items-center justify-between border-b border-gray-800 bg-gray-900 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-100">{title}</h2>
          <p className={`text-xs ${totalClassName ?? "text-gray-500"}`}>{totalLabel}</p>
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
          ? "border-blue-600 bg-blue-900/40 text-blue-300"
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
  children,
}: {
  label: string;
  total: string;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-md border border-gray-700 bg-gray-900/60">
      <div className="flex items-center justify-between border-b border-gray-700 bg-gray-800/60 px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-200">{label}</span>
        <span className="text-xs font-medium text-gray-300">{total}</span>
      </div>
      <div className="divide-y divide-gray-800">{children}</div>
    </div>
  );
}

function Row({
  onClick,
  editMode,
  onDelete,
  label,
  subLabel,
  value,
  valueClassName,
}: {
  onClick: () => void;
  editMode: boolean;
  onDelete: () => void;
  label: string;
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
        <div className="truncate text-sm font-medium text-gray-100">{label}</div>
        {subLabel && <div className="truncate text-xs text-gray-500">{subLabel}</div>}
      </div>
      <div className="flex items-center gap-3">
        <span className={`text-sm font-medium ${valueClassName ?? "text-gray-100"}`}>{value}</span>
        {editMode && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="text-gray-500 hover:text-red-400"
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
  return <div className="px-4 py-8 text-center text-sm text-gray-500">{message}</div>;
}
