"use client";

import { useState } from "react";
import ConfirmDeleteDialog from "./confirm-delete-dialog";
import MilestoneYearPicker from "./milestone-year-picker";
import ScheduleTab from "./schedule-tab";
import { CurrencyInput } from "./currency-input";
import type { YearRef, ClientMilestones } from "@/lib/milestones";
import { defaultIncomeRefs, defaultExpenseRefs, resolveMilestone } from "@/lib/milestones";
import { individualOwnerLabel, type OwnerNames } from "@/lib/owner-labels";

// ── Types ─────────────────────────────────────────────────────────────────────

type IncomeType = "salary" | "social_security" | "business" | "deferred" | "capital_gains" | "trust" | "other";
type ExpenseType = "living" | "other" | "insurance";
type Owner = "client" | "spouse" | "joint";

interface Income {
  id: string;
  type: IncomeType;
  name: string;
  annualAmount: string;
  startYear: number;
  endYear: number;
  owner: Owner;
  claimingAge: number | null;
  linkedEntityId: string | null;
  growthRate: string;
  ownerEntityId?: string | null;
  cashAccountId?: string | null;
  inflationStartYear?: number | null;
  startYearRef?: string | null;
  endYearRef?: string | null;
  taxType?: string | null;
}

type IncomeTaxType = "earned_income" | "ordinary_income" | "dividends" | "capital_gains" | "qbi" | "tax_exempt" | "stcg";

const INCOME_TAX_TYPE_LABELS: Record<IncomeTaxType, string> = {
  earned_income: "Earned Income",
  ordinary_income: "Ordinary Income",
  dividends: "Dividends",
  capital_gains: "Capital Gains",
  qbi: "QBI",
  tax_exempt: "Tax-Exempt",
  stcg: "ST Capital Gains",
};

function defaultTaxTypeFor(incType: IncomeType): IncomeTaxType {
  switch (incType) {
    case "salary": return "earned_income";
    case "social_security": return "ordinary_income";
    case "business": return "ordinary_income";
    case "deferred": return "ordinary_income";
    case "capital_gains": return "capital_gains";
    case "trust": return "ordinary_income";
    default: return "ordinary_income";
  }
}

interface Expense {
  id: string;
  type: ExpenseType;
  name: string;
  annualAmount: string;
  startYear: number;
  endYear: number;
  growthRate: string;
  ownerEntityId?: string | null;
  cashAccountId?: string | null;
  inflationStartYear?: number | null;
  startYearRef?: string | null;
  endYearRef?: string | null;
  deductionType?: string | null;
}

interface SavingsRule {
  id: string;
  accountId: string;
  annualAmount: string;
  startYear: number;
  endYear: number;
  employerMatchPct: string | null;
  employerMatchCap: string | null;
  employerMatchAmount: string | null;
  annualLimit: string | null;
}

interface Account {
  id: string;
  name: string;
  category: string;
  subType: string;
  isDefaultChecking?: boolean | null;
  ownerEntityId?: string | null;
}

interface Entity {
  id: string;
  name: string;
}

interface ClientInfo {
  clientRetirementYear: number;
  clientEndYear: number;
  spouseRetirementYear?: number;
  spouseEndYear?: number;
  planStartYear: number;
  planEndYear: number;
  milestones?: ClientMilestones;
}

type ScheduleMap = Record<string, { year: number; amount: number }[]>;

interface IncomeExpensesViewProps {
  clientId: string;
  initialIncomes: Income[];
  initialExpenses: Expense[];
  initialSavingsRules: SavingsRule[];
  accounts: Account[];
  entities?: Entity[];
  clientInfo?: ClientInfo;
  ownerNames: OwnerNames;
  incomeSchedules: ScheduleMap;
  expenseSchedules: ScheduleMap;
  savingsSchedules: ScheduleMap;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = (value: string | number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(
    Number(value)
  );

const pctFromDecimal = (v: string | null | undefined, fallback: number): number => {
  if (v === null || v === undefined || v === "") return fallback;
  return Math.round(Number(v) * 10000) / 100;
};

const INCOME_GROUPS: { label: string; types: IncomeType[] }[] = [
  { label: "Salaries", types: ["salary"] },
  { label: "Social Security", types: ["social_security"] },
  { label: "Business", types: ["business"] },
  { label: "Deferred", types: ["deferred"] },
  { label: "Capital Gains", types: ["capital_gains"] },
  { label: "Trust", types: ["trust"] },
  { label: "Other Income", types: ["other"] },
];

const EXPENSE_GROUPS: { label: string; types: ExpenseType[] }[] = [
  { label: "Living Expenses", types: ["living"] },
  { label: "Insurance", types: ["insurance"] },
  { label: "Other Expenses", types: ["other"] },
];

const INCOME_TYPE_LABELS: Record<IncomeType, string> = {
  salary: "Salary",
  social_security: "Social Security",
  business: "Business",
  deferred: "Deferred",
  capital_gains: "Capital Gains",
  trust: "Trust",
  other: "Other",
};


function yearsDescriptor(start: number, end: number, planStart?: number, planEnd?: number): string {
  if (planStart !== undefined && planEnd !== undefined && start <= planStart && end >= planEnd) {
    return "Active";
  }
  if (start === end) return String(start);
  return `${start}–${end}`;
}

// ── Shared atoms ──────────────────────────────────────────────────────────────

function TrashIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
      <path
        fillRule="evenodd"
        d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function PlusMiniIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
    </svg>
  );
}

function SectionHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between border-b border-gray-800 bg-gray-900 px-4 py-3">
      <div>
        <h2 className="text-sm font-semibold text-gray-100">{title}</h2>
        {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

function EditToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={`rounded-md border px-2.5 py-1 text-[11px] font-medium ${
        on
          ? "border-blue-600 bg-blue-900/40 text-blue-300"
          : "border-gray-700 bg-gray-900 text-gray-400 hover:bg-gray-800"
      }`}
    >
      {on ? "Done" : "Edit"}
    </button>
  );
}

function AddGroupButton({ onClick, label = "Add" }: { onClick: () => void; label?: string }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-gray-800 text-gray-500 hover:bg-blue-900 hover:text-blue-400"
      aria-label={label}
      title={label}
    >
      <PlusMiniIcon />
    </button>
  );
}

// ── Cash Account Picker ───────────────────────────────────────────────────────

interface CashAccountPickerProps {
  id: string;
  label: string;
  accounts: Account[];
  ownerEntityId?: string | null;
  value: string;
  onChange: (v: string) => void;
}

/**
 * Pick the cash account an income deposits into or an expense is paid from.
 * Shows every cash-category account; entity-owned accounts are grouped under the
 * entity so advisors can pick a trust's cash without hunting for it. The empty
 * value means "use the default checking for this owner".
 */
function CashAccountPicker({
  id,
  label,
  accounts,
  ownerEntityId,
  value,
  onChange,
}: CashAccountPickerProps) {
  const cashAccounts = accounts.filter((a) => a.category === "cash");
  if (cashAccounts.length === 0) return null;

  const household = cashAccounts.filter((a) => !a.ownerEntityId);
  const entityBuckets = new Map<string, Account[]>();
  for (const a of cashAccounts) {
    if (!a.ownerEntityId) continue;
    const arr = entityBuckets.get(a.ownerEntityId) ?? [];
    arr.push(a);
    entityBuckets.set(a.ownerEntityId, arr);
  }

  const defaultAcct = ownerEntityId
    ? cashAccounts.find((a) => a.ownerEntityId === ownerEntityId && a.isDefaultChecking)
    : cashAccounts.find((a) => !a.ownerEntityId && a.isDefaultChecking);
  const defaultLabel = defaultAcct ? defaultAcct.name : "Household Cash";

  return (
    <div>
      <label className="block text-sm font-medium text-gray-300" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      >
        <option value="">Default ({defaultLabel})</option>
        {household.length > 0 && (
          <optgroup label="Household">
            {household.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.isDefaultChecking ? " · default" : ""}
              </option>
            ))}
          </optgroup>
        )}
        {[...entityBuckets.entries()].map(([entId, bucket]) => (
          <optgroup key={entId} label="Entity">
            {bucket.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.isDefaultChecking ? " · default" : ""}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}

// ── Income Dialog ─────────────────────────────────────────────────────────────

interface IncomeDialogProps {
  clientId: string;
  defaultType?: IncomeType;
  accounts: Account[];
  entities?: Entity[];
  clientInfo?: ClientInfo;
  ownerNames: OwnerNames;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: Income;
  onSaved: (income: Income, mode: "create" | "edit") => void;
  onRequestDelete?: () => void;
  schedule?: { year: number; amount: number }[];
}

function IncomeDialog({
  clientId,
  defaultType = "salary",
  accounts,
  entities,
  clientInfo,
  ownerNames,
  open,
  onOpenChange,
  editing,
  onSaved,
  onRequestDelete,
  schedule,
}: IncomeDialogProps) {
  type TabId = "details" | "schedule";
  const [activeTab, setActiveTab] = useState<TabId>("details");
  const [hasSchedule, setHasSchedule] = useState((schedule ?? []).length > 0);
  const [stagedSchedule, setStagedSchedule] = useState<{ year: number; amount: number }[]>(schedule ?? []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<IncomeType>(editing?.type ?? defaultType);
  const [owner, setOwner] = useState<Owner>(editing?.owner ?? "client");
  const [ownerEntityId, setOwnerEntityId] = useState<string>(editing?.ownerEntityId ?? "");
  const [cashAccountId, setCashAccountId] = useState<string>(editing?.cashAccountId ?? "");
  const planStartYear = clientInfo?.planStartYear ?? new Date().getFullYear();
  const [todaysDollars, setTodaysDollars] = useState<boolean>(
    editing?.inflationStartYear != null && editing.inflationStartYear < editing.startYear
  );
  const currentYear = new Date().getFullYear();
  const isEdit = Boolean(editing);
  const isSocialSecurity = type === "social_security";
  const [taxType, setTaxType] = useState<IncomeTaxType>(
    (editing?.taxType as IncomeTaxType) ?? defaultTaxTypeFor(type)
  );

  const incDefaultRefs = !isEdit ? defaultIncomeRefs(type, owner) : null;
  const [startYearRef, setStartYearRef] = useState<YearRef | null>(
    (editing?.startYearRef as YearRef) ?? incDefaultRefs?.startYearRef ?? null
  );
  const [endYearRef, setEndYearRef] = useState<YearRef | null>(
    (editing?.endYearRef as YearRef) ?? incDefaultRefs?.endYearRef ?? null
  );
  const [startYear, setStartYear] = useState<number>(
    editing?.startYear ?? (startYearRef && clientInfo?.milestones ? resolveMilestone(startYearRef, clientInfo.milestones) ?? currentYear : currentYear)
  );
  const [endYear, setEndYear] = useState<number>(
    editing?.endYear ?? (endYearRef && clientInfo?.milestones ? resolveMilestone(endYearRef, clientInfo.milestones) ?? (currentYear + 20) : currentYear + 20)
  );

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const data = new FormData(e.currentTarget);

    let submitStartYear: string;
    let submitEndYear: string;
    let claimingAge: string | null = null;

    if (isSocialSecurity) {
      claimingAge = data.get("claimingAge") as string;
      submitStartYear = String(clientInfo?.planStartYear ?? currentYear);
      submitEndYear = String(clientInfo?.planEndYear ?? currentYear + 30);
    } else {
      submitStartYear = String(startYear);
      submitEndYear = String(endYear);
      claimingAge = data.get("claimingAge") ? (data.get("claimingAge") as string) : null;
    }

    const body = {
      type: data.get("type") as string,
      name: data.get("name") as string,
      annualAmount: data.get("annualAmount") as string,
      startYear: submitStartYear,
      endYear: submitEndYear,
      growthRate: String(Number(data.get("growthRate") as string) / 100),
      owner: data.get("owner") as string,
      claimingAge,
      linkedEntityId: data.get("linkedEntityId") || null,
      ownerEntityId: ownerEntityId || null,
      cashAccountId: cashAccountId || null,
      // "Today's dollars" mode inflates the amount from plan start through the
      // entry's startYear so retirement-era amounts can be entered in current
      // purchasing power. Null means inflate only from startYear onward.
      inflationStartYear: todaysDollars ? planStartYear : null,
      startYearRef: isSocialSecurity ? null : startYearRef,
      endYearRef: isSocialSecurity ? null : endYearRef,
      taxType,
    };

    try {
      const url = isEdit
        ? `/api/clients/${clientId}/incomes/${editing!.id}`
        : `/api/clients/${clientId}/incomes`;
      const res = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? "Failed to save income");
      }

      const saved = (await res.json()) as Income;

      // On create: if a schedule was staged, persist it now that we have the ID.
      if (!isEdit && stagedSchedule.length > 0) {
        await fetch(`/api/clients/${clientId}/incomes/${saved.id}/schedule`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ overrides: stagedSchedule }),
        });
      }

      onSaved(saved, isEdit ? "edit" : "create");
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  const needsLinkedEntity = type === "business" || type === "trust";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={() => onOpenChange(false)} />
      <div className="relative z-10 w-full max-w-lg rounded-lg border border-gray-700 bg-gray-900 p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-100">{isEdit ? "Edit Income" : "Add Income"}</h2>
          <button onClick={() => onOpenChange(false)} className="text-gray-400 hover:text-gray-200">
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        <div className="mb-4 flex border-b border-gray-700">
          <button type="button" onClick={() => setActiveTab("details")} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "details" ? "border-blue-500 text-blue-400" : "border-transparent text-gray-400 hover:text-gray-200"}`}>Details</button>
          <button type="button" onClick={() => setActiveTab("schedule")} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "schedule" ? "border-blue-500 text-blue-400" : "border-transparent text-gray-400 hover:text-gray-200"}`}>Schedule</button>
        </div>

        {activeTab === "details" && (<form onSubmit={handleSubmit} className="space-y-4">
          {error && <p className="rounded bg-red-900/50 px-3 py-2 text-sm text-red-400">{error}</p>}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300" htmlFor="inc-type">Type</label>
              <select
                id="inc-type"
                name="type"
                required
                value={type}
                onChange={(e) => setType(e.target.value as IncomeType)}
                className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {Object.entries(INCOME_TYPE_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300" htmlFor="inc-taxType">Tax Treatment</label>
              <select
                id="inc-taxType"
                name="taxType"
                value={taxType}
                onChange={(e) => setTaxType(e.target.value as IncomeTaxType)}
                className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {Object.entries(INCOME_TAX_TYPE_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300" htmlFor="inc-owner">Owner</label>
              <select
                id="inc-owner"
                name="owner"
                value={owner}
                onChange={(e) => setOwner(e.target.value as Owner)}
                className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="client">{ownerNames.clientName}</option>
                <option value="spouse" disabled={!ownerNames.spouseName}>
                  {ownerNames.spouseName ?? "Spouse (none on file)"}
                </option>
                <option value="joint">Joint</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300" htmlFor="inc-name">
              Name <span className="text-red-500">*</span>
            </label>
            <input
              id="inc-name"
              name="name"
              type="text"
              required
              defaultValue={editing?.name ?? ""}
              placeholder="e.g., Base Salary"
              className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300" htmlFor="inc-amount">
                Annual Amount ($) <span className="text-red-500">*</span>
              </label>
              <CurrencyInput
                id="inc-amount"
                name="annualAmount"
                required
                defaultValue={editing?.annualAmount ?? 0}
                className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 py-2 pr-3 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            {hasSchedule ? (
              <div className="flex items-end">
                <p className="text-xs text-blue-400 cursor-pointer" onClick={() => setActiveTab("schedule")}>Using custom schedule</p>
              </div>
            ) : (
              <div>
                <label className="block text-sm font-medium text-gray-300" htmlFor="inc-growth">Growth Rate (%)</label>
                <input
                  id="inc-growth"
                  name="growthRate"
                  type="number"
                  step="0.1"
                  min={0}
                  max={30}
                  defaultValue={pctFromDecimal(editing?.growthRate, isSocialSecurity ? 2 : 3)}
                  className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <label className="mt-1 flex items-center gap-1.5 text-[11px] text-gray-400">
                  <input
                    type="checkbox"
                    checked={todaysDollars}
                    onChange={(e) => setTodaysDollars(e.target.checked)}
                    className="h-3 w-3 rounded border-gray-600 bg-gray-800 text-blue-600 focus:ring-blue-500"
                  />
                  Amount in today&apos;s dollars (inflate from {planStartYear})
                </label>
              </div>
            )}

            {isSocialSecurity ? (
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-300" htmlFor="inc-claiming">Claiming Age</label>
                <input
                  id="inc-claiming"
                  name="claimingAge"
                  type="number"
                  min={62}
                  max={70}
                  defaultValue={editing?.claimingAge ?? 67}
                  className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <p className="mt-1 text-xs text-gray-400">
                  Start/end years are auto-set to plan range. Benefits begin at claiming age.
                </p>
              </div>
            ) : clientInfo?.milestones ? (
              <>
                <MilestoneYearPicker
                  name="startYear"
                  id="inc-start"
                  value={startYear}
                  yearRef={startYearRef}
                  milestones={clientInfo.milestones}
                  showSSRefs={false}
                  onChange={(yr, ref) => { setStartYear(yr); setStartYearRef(ref); }}
                  label="Start Year"
                />
                <MilestoneYearPicker
                  name="endYear"
                  id="inc-end"
                  value={endYear}
                  yearRef={endYearRef}
                  milestones={clientInfo.milestones}
                  showSSRefs={false}
                  onChange={(yr, ref) => { setEndYear(yr); setEndYearRef(ref); }}
                  label="End Year"
                />
              </>
            ) : (
              <>
                <div>
                  <label className="block text-xs font-medium text-gray-400" htmlFor="inc-start">
                    Start Year
                  </label>
                  <input
                    id="inc-start"
                    name="startYear"
                    type="number"
                    required
                    value={startYear}
                    onChange={(e) => { setStartYear(Number(e.target.value)); setStartYearRef(null); }}
                    className="mt-1 block w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400" htmlFor="inc-end">
                    End Year
                  </label>
                  <input
                    id="inc-end"
                    name="endYear"
                    type="number"
                    required
                    value={endYear}
                    onChange={(e) => { setEndYear(Number(e.target.value)); setEndYearRef(null); }}
                    className="mt-1 block w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </>
            )}
          </div>

          {needsLinkedEntity && accounts.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-300" htmlFor="inc-linked">
                Linked Account (optional)
              </label>
              <select
                id="inc-linked"
                name="linkedEntityId"
                defaultValue={editing?.linkedEntityId ?? ""}
                className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">None</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
          )}

          {entities && entities.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-300" htmlFor="inc-entity">
                Received by entity (out of estate)
              </label>
              <select
                id="inc-entity"
                value={ownerEntityId}
                onChange={(e) => setOwnerEntityId(e.target.value)}
                className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">Household (individual owner)</option>
                {entities.map((ent) => (
                  <option key={ent.id} value={ent.id}>{ent.name}</option>
                ))}
              </select>
              {ownerEntityId && (
                <p className="mt-1 text-xs text-amber-400">Counted as out of estate.</p>
              )}
            </div>
          )}

          <CashAccountPicker
            id="inc-cash"
            label="Deposits to"
            accounts={accounts}
            ownerEntityId={ownerEntityId || null}
            value={cashAccountId}
            onChange={setCashAccountId}
          />

          <div className="flex items-center justify-between pt-2">
            {isEdit && onRequestDelete ? (
              <button
                type="button"
                onClick={onRequestDelete}
                className="rounded-md border border-red-700 bg-red-900/30 px-4 py-2 text-sm font-medium text-red-400 hover:bg-red-900/60"
              >
                Delete…
              </button>
            ) : (
              <span />
            )}
            <button
              type="submit"
              disabled={loading}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? "Saving…" : isEdit ? "Save Changes" : "Add Income"}
            </button>
          </div>
        </form>)}

        {activeTab === "schedule" && (
          <ScheduleTab
            startYear={startYear}
            endYear={endYear}
            initialOverrides={stagedSchedule}
            onSave={async (overrides) => {
              if (editing) {
                await fetch(`/api/clients/${clientId}/incomes/${editing.id}/schedule`, {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ overrides }),
                });
              }
              setStagedSchedule(overrides);
              setHasSchedule(overrides.length > 0);
            }}
            onClear={async () => {
              if (editing) {
                await fetch(`/api/clients/${clientId}/incomes/${editing.id}/schedule`, { method: "DELETE" });
              }
              setStagedSchedule([]);
              setHasSchedule(false);
            }}
          />
        )}
      </div>
    </div>
  );
}

// ── Expense Dialog ────────────────────────────────────────────────────────────

interface ExpenseDialogProps {
  clientId: string;
  defaultType?: ExpenseType;
  accounts: Account[];
  entities?: Entity[];
  clientInfo?: ClientInfo;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: Expense;
  onSaved: (expense: Expense, mode: "create" | "edit") => void;
  onRequestDelete?: () => void;
  schedule?: { year: number; amount: number }[];
}

function ExpenseDialog({
  clientId,
  defaultType = "living",
  accounts,
  entities,
  clientInfo,
  open,
  onOpenChange,
  editing,
  onSaved,
  onRequestDelete,
  schedule,
}: ExpenseDialogProps) {
  type ExpTabId = "details" | "schedule";
  const [activeTab, setActiveTab] = useState<ExpTabId>("details");
  const [hasSchedule, setHasSchedule] = useState((schedule ?? []).length > 0);
  const [stagedSchedule, setStagedSchedule] = useState<{ year: number; amount: number }[]>(schedule ?? []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ownerEntityId, setOwnerEntityId] = useState<string>(editing?.ownerEntityId ?? "");
  const [cashAccountId, setCashAccountId] = useState<string>(editing?.cashAccountId ?? "");
  const [deductionType, setDeductionType] = useState<string>(editing?.deductionType ?? "");
  const planStartYear = clientInfo?.planStartYear ?? new Date().getFullYear();
  const [todaysDollars, setTodaysDollars] = useState<boolean>(
    editing?.inflationStartYear != null && editing.inflationStartYear < editing.startYear
  );
  const currentYear = new Date().getFullYear();
  const isEdit = Boolean(editing);

  const expDefaultRefs = !isEdit ? defaultExpenseRefs(editing?.type ?? defaultType) : null;
  const [startYearRef, setStartYearRef] = useState<YearRef | null>(
    (editing?.startYearRef as YearRef) ?? expDefaultRefs?.startYearRef ?? null
  );
  const [endYearRef, setEndYearRef] = useState<YearRef | null>(
    (editing?.endYearRef as YearRef) ?? expDefaultRefs?.endYearRef ?? null
  );
  const [startYear, setStartYear] = useState<number>(
    editing?.startYear ?? (startYearRef && clientInfo?.milestones ? resolveMilestone(startYearRef, clientInfo.milestones) ?? currentYear : currentYear)
  );
  const [endYear, setEndYear] = useState<number>(
    editing?.endYear ?? (endYearRef && clientInfo?.milestones ? resolveMilestone(endYearRef, clientInfo.milestones) ?? (currentYear + 20) : currentYear + 20)
  );

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const data = new FormData(e.currentTarget);
    const body = {
      type: data.get("type") as string,
      name: data.get("name") as string,
      annualAmount: data.get("annualAmount") as string,
      startYear: String(startYear),
      endYear: String(endYear),
      growthRate: String(Number(data.get("growthRate") as string) / 100),
      ownerEntityId: ownerEntityId || null,
      cashAccountId: cashAccountId || null,
      inflationStartYear: todaysDollars ? planStartYear : null,
      startYearRef,
      endYearRef,
      deductionType: deductionType || null,
    };

    try {
      const url = isEdit
        ? `/api/clients/${clientId}/expenses/${editing!.id}`
        : `/api/clients/${clientId}/expenses`;
      const res = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? "Failed to save expense");
      }

      const saved = (await res.json()) as Expense;

      // On create: if a schedule was staged, persist it now that we have the ID.
      if (!isEdit && stagedSchedule.length > 0) {
        await fetch(`/api/clients/${clientId}/expenses/${saved.id}/schedule`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ overrides: stagedSchedule }),
        });
      }

      onSaved(saved, isEdit ? "edit" : "create");
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={() => onOpenChange(false)} />
      <div className="relative z-10 w-full max-w-lg rounded-lg border border-gray-700 bg-gray-900 p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-100">{isEdit ? "Edit Expense" : "Add Expense"}</h2>
          <button onClick={() => onOpenChange(false)} className="text-gray-400 hover:text-gray-200">
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        <div className="mb-4 flex border-b border-gray-700">
          <button type="button" onClick={() => setActiveTab("details")} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "details" ? "border-blue-500 text-blue-400" : "border-transparent text-gray-400 hover:text-gray-200"}`}>Details</button>
          <button type="button" onClick={() => setActiveTab("schedule")} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "schedule" ? "border-blue-500 text-blue-400" : "border-transparent text-gray-400 hover:text-gray-200"}`}>Schedule</button>
        </div>

        {activeTab === "details" && (<form onSubmit={handleSubmit} className="space-y-4">
          {error && <p className="rounded bg-red-900/50 px-3 py-2 text-sm text-red-400">{error}</p>}

          <div>
            <label className="block text-sm font-medium text-gray-300" htmlFor="exp-type">Type</label>
            <select
              id="exp-type"
              name="type"
              required
              defaultValue={editing?.type ?? defaultType}
              className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="living">Living Expense</option>
              <option value="insurance">Insurance</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300" htmlFor="exp-name">
              Name <span className="text-red-500">*</span>
            </label>
            <input
              id="exp-name"
              name="name"
              type="text"
              required
              defaultValue={editing?.name ?? ""}
              placeholder="e.g., Housing"
              className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300" htmlFor="exp-amount">
                Annual Amount ($) <span className="text-red-500">*</span>
              </label>
              <CurrencyInput
                id="exp-amount"
                name="annualAmount"
                required
                defaultValue={editing?.annualAmount ?? 0}
                className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 py-2 pr-3 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            {hasSchedule ? (
              <div className="flex items-end">
                <p className="text-xs text-blue-400 cursor-pointer" onClick={() => setActiveTab("schedule")}>Using custom schedule</p>
              </div>
            ) : (
              <div>
                <label className="block text-sm font-medium text-gray-300" htmlFor="exp-growth">Growth Rate (%)</label>
                <input
                  id="exp-growth"
                  name="growthRate"
                  type="number"
                  step="0.1"
                  min={0}
                  max={30}
                  defaultValue={pctFromDecimal(editing?.growthRate, 3)}
                  className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <label className="mt-1 flex items-center gap-1.5 text-[11px] text-gray-400">
                  <input
                    type="checkbox"
                    checked={todaysDollars}
                    onChange={(e) => setTodaysDollars(e.target.checked)}
                    className="h-3 w-3 rounded border-gray-600 bg-gray-800 text-blue-600 focus:ring-blue-500"
                  />
                  Amount in today&apos;s dollars (inflate from {planStartYear})
                </label>
              </div>
            )}

            {clientInfo?.milestones ? (
              <>
                <MilestoneYearPicker
                  name="startYear"
                  id="exp-start"
                  value={startYear}
                  yearRef={startYearRef}
                  milestones={clientInfo.milestones}
                  showSSRefs={false}
                  onChange={(yr, ref) => { setStartYear(yr); setStartYearRef(ref); }}
                  label="Start Year"
                />
                <MilestoneYearPicker
                  name="endYear"
                  id="exp-end"
                  value={endYear}
                  yearRef={endYearRef}
                  milestones={clientInfo.milestones}
                  showSSRefs={false}
                  onChange={(yr, ref) => { setEndYear(yr); setEndYearRef(ref); }}
                  label="End Year"
                />
              </>
            ) : (
              <>
                <div>
                  <label className="block text-xs font-medium text-gray-400" htmlFor="exp-start">
                    Start Year
                  </label>
                  <input
                    id="exp-start"
                    name="startYear"
                    type="number"
                    required
                    value={startYear}
                    onChange={(e) => { setStartYear(Number(e.target.value)); setStartYearRef(null); }}
                    className="mt-1 block w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400" htmlFor="exp-end">
                    End Year
                  </label>
                  <input
                    id="exp-end"
                    name="endYear"
                    type="number"
                    required
                    value={endYear}
                    onChange={(e) => { setEndYear(Number(e.target.value)); setEndYearRef(null); }}
                    className="mt-1 block w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </>
            )}
          </div>

          {entities && entities.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-300" htmlFor="exp-entity">
                Paid by entity (out of estate)
              </label>
              <select
                id="exp-entity"
                value={ownerEntityId}
                onChange={(e) => setOwnerEntityId(e.target.value)}
                className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">Household</option>
                {entities.map((ent) => (
                  <option key={ent.id} value={ent.id}>{ent.name}</option>
                ))}
              </select>
              {ownerEntityId && (
                <p className="mt-1 text-xs text-amber-400">Counted as out of estate.</p>
              )}
            </div>
          )}

          <CashAccountPicker
            id="exp-cash"
            label="Paid from"
            accounts={accounts}
            ownerEntityId={ownerEntityId || null}
            value={cashAccountId}
            onChange={setCashAccountId}
          />

          <div>
            <label className="block text-sm font-medium text-gray-300" htmlFor="exp-deductionType">Tax Treatment</label>
            <select
              id="exp-deductionType"
              value={deductionType}
              onChange={(e) => setDeductionType(e.target.value)}
              className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">None (not a deduction)</option>
              <option value="charitable">Charitable Gift</option>
              <option value="above_line">Above Line Deduction</option>
              <option value="below_line">Below Line Deduction</option>
              <option value="property_tax">Property Tax</option>
            </select>
          </div>

          <div className="flex items-center justify-between pt-2">
            {isEdit && onRequestDelete ? (
              <button
                type="button"
                onClick={onRequestDelete}
                className="rounded-md border border-red-700 bg-red-900/30 px-4 py-2 text-sm font-medium text-red-400 hover:bg-red-900/60"
              >
                Delete…
              </button>
            ) : (
              <span />
            )}
            <button
              type="submit"
              disabled={loading}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? "Saving…" : isEdit ? "Save Changes" : "Add Expense"}
            </button>
          </div>
        </form>)}

        {activeTab === "schedule" && (
          <ScheduleTab
            startYear={startYear}
            endYear={endYear}
            initialOverrides={stagedSchedule}
            onSave={async (overrides) => {
              if (editing) {
                await fetch(`/api/clients/${clientId}/expenses/${editing.id}/schedule`, {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ overrides }),
                });
              }
              setStagedSchedule(overrides);
              setHasSchedule(overrides.length > 0);
            }}
            onClear={async () => {
              if (editing) {
                await fetch(`/api/clients/${clientId}/expenses/${editing.id}/schedule`, { method: "DELETE" });
              }
              setStagedSchedule([]);
              setHasSchedule(false);
            }}
          />
        )}
      </div>
    </div>
  );
}

// ── Savings Rule Dialog ───────────────────────────────────────────────────────

interface SavingsRuleDialogProps {
  clientId: string;
  accounts: Account[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: SavingsRule;
  onSaved: (rule: SavingsRule, mode: "create" | "edit") => void;
  onRequestDelete?: () => void;
  schedule?: { year: number; amount: number }[];
}

function SavingsRuleDialog({
  clientId,
  accounts,
  open,
  onOpenChange,
  editing,
  onSaved,
  onRequestDelete,
  schedule,
}: SavingsRuleDialogProps) {
  type SavTabId = "details" | "schedule";
  const [activeTab, setActiveTab] = useState<SavTabId>("details");
  const [hasSchedule, setHasSchedule] = useState((schedule ?? []).length > 0);
  const [stagedSchedule, setStagedSchedule] = useState<{ year: number; amount: number }[]>(schedule ?? []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentYear = new Date().getFullYear();
  const isEdit = Boolean(editing);
  const [startYear, setStartYear] = useState<number>(editing?.startYear ?? currentYear);
  const [endYear, setEndYear] = useState<number>(editing?.endYear ?? currentYear + 20);

  // Match mode: "none" | "percent" | "flat". Inferred from what's populated on the
  // rule being edited; defaults to "none" for new rules.
  type MatchMode = "none" | "percent" | "flat";
  const initialMatchMode: MatchMode = editing?.employerMatchAmount
    ? "flat"
    : editing?.employerMatchPct
    ? "percent"
    : "none";
  const [matchMode, setMatchMode] = useState<MatchMode>(initialMatchMode);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const data = new FormData(e.currentTarget);
    const matchPct = data.get("employerMatchPct") as string;
    const matchCap = data.get("employerMatchCap") as string;
    const matchAmount = data.get("employerMatchAmount") as string;
    const limit = data.get("annualLimit") as string;

    const body = {
      accountId: data.get("accountId") as string,
      annualAmount: data.get("annualAmount") as string,
      startYear: data.get("startYear") as string,
      endYear: data.get("endYear") as string,
      employerMatchPct:
        matchMode === "percent" && matchPct ? String(Number(matchPct) / 100) : null,
      employerMatchCap:
        matchMode === "percent" && matchCap ? String(Number(matchCap) / 100) : null,
      employerMatchAmount: matchMode === "flat" && matchAmount ? matchAmount : null,
      annualLimit: limit || null,
    };

    try {
      const url = isEdit
        ? `/api/clients/${clientId}/savings-rules/${editing!.id}`
        : `/api/clients/${clientId}/savings-rules`;
      const res = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? "Failed to save savings rule");
      }

      const saved = (await res.json()) as SavingsRule;

      // On create: if a schedule was staged, persist it now that we have the ID.
      if (!isEdit && stagedSchedule.length > 0) {
        await fetch(`/api/clients/${clientId}/savings-rules/${saved.id}/schedule`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ overrides: stagedSchedule }),
        });
      }

      onSaved(saved, isEdit ? "edit" : "create");
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={() => onOpenChange(false)} />
      <div className="relative z-10 w-full max-w-lg rounded-lg border border-gray-700 bg-gray-900 p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-100">{isEdit ? "Edit Savings Rule" : "Add Savings Rule"}</h2>
          <button onClick={() => onOpenChange(false)} className="text-gray-400 hover:text-gray-200">
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        <div className="mb-4 flex border-b border-gray-700">
          <button type="button" onClick={() => setActiveTab("details")} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "details" ? "border-blue-500 text-blue-400" : "border-transparent text-gray-400 hover:text-gray-200"}`}>Details</button>
          <button type="button" onClick={() => setActiveTab("schedule")} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "schedule" ? "border-blue-500 text-blue-400" : "border-transparent text-gray-400 hover:text-gray-200"}`}>Schedule</button>
        </div>

        {activeTab === "details" && (<form onSubmit={handleSubmit} className="space-y-4">
          {error && <p className="rounded bg-red-900/50 px-3 py-2 text-sm text-red-400">{error}</p>}

          <div>
            <label className="block text-sm font-medium text-gray-300" htmlFor="sr-account">
              Account <span className="text-red-500">*</span>
            </label>
            <select
              id="sr-account"
              name="accountId"
              required
              defaultValue={editing?.accountId ?? (accounts[0]?.id ?? "")}
              className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300" htmlFor="sr-amount">
                Annual Amount ($) <span className="text-red-500">*</span>
              </label>
              <CurrencyInput
                id="sr-amount"
                name="annualAmount"
                required
                defaultValue={editing?.annualAmount ?? 0}
                className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 py-2 pr-3 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              {hasSchedule && (
                <p className="mt-1 text-xs text-blue-400 cursor-pointer" onClick={() => setActiveTab("schedule")}>Using custom schedule</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300" htmlFor="sr-limit">Annual Limit ($)</label>
              <CurrencyInput
                id="sr-limit"
                name="annualLimit"
                placeholder="Optional"
                defaultValue={editing?.annualLimit ?? ""}
                className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 py-2 pr-3 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div className="col-span-2 rounded-md border border-gray-800 bg-gray-900/60 p-3">
              <div className="mb-2 flex items-center gap-4">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                  Employer Match
                </span>
                <div className="flex gap-1 text-xs">
                  {(["none", "percent", "flat"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMatchMode(m)}
                      className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${
                        matchMode === m
                          ? "border-blue-600 bg-blue-900/40 text-blue-300"
                          : "border-gray-700 bg-gray-900 text-gray-400 hover:bg-gray-800"
                      }`}
                    >
                      {m === "none" ? "None" : m === "percent" ? "% of salary" : "Flat $"}
                    </button>
                  ))}
                </div>
              </div>

              {matchMode === "percent" && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-400" htmlFor="sr-match-pct">
                      Match rate (%)
                    </label>
                    <input
                      id="sr-match-pct"
                      name="employerMatchPct"
                      type="number"
                      step="0.01"
                      min={0}
                      max={100}
                      placeholder="e.g., 50 or 3"
                      defaultValue={
                        editing?.employerMatchPct ? pctFromDecimal(editing.employerMatchPct, 0) : ""
                      }
                      className="mt-1 block w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-400" htmlFor="sr-match-cap">
                      Cap (% of salary) — optional
                    </label>
                    <input
                      id="sr-match-cap"
                      name="employerMatchCap"
                      type="number"
                      step="0.1"
                      min={0}
                      max={100}
                      placeholder="e.g., 6"
                      defaultValue={
                        editing?.employerMatchCap ? pctFromDecimal(editing.employerMatchCap, 0) : ""
                      }
                      className="mt-1 block w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <p className="col-span-2 text-[11px] text-gray-500">
                    No cap → <code>rate × account-owner salary</code>. With cap →{" "}
                    <code>rate × cap × salary</code> (e.g. 50% match up to 6% of salary).
                  </p>
                </div>
              )}

              {matchMode === "flat" && (
                <div>
                  <label className="block text-xs font-medium text-gray-400" htmlFor="sr-match-amt">
                    Flat annual amount ($)
                  </label>
                  <CurrencyInput
                    id="sr-match-amt"
                    name="employerMatchAmount"
                    placeholder="5000"
                    defaultValue={editing?.employerMatchAmount ?? ""}
                    className="mt-1 block w-full rounded-md border border-gray-700 bg-gray-800 py-2 pr-3 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <p className="mt-1 text-[11px] text-gray-500">
                    The employer deposits this flat amount each year, regardless of salary.
                  </p>
                </div>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300" htmlFor="sr-start">
                Start Year <span className="text-red-500">*</span>
              </label>
              <input
                id="sr-start"
                name="startYear"
                type="number"
                required
                value={startYear}
                onChange={(e) => setStartYear(Number(e.target.value))}
                className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300" htmlFor="sr-end">
                End Year <span className="text-red-500">*</span>
              </label>
              <input
                id="sr-end"
                name="endYear"
                type="number"
                required
                value={endYear}
                onChange={(e) => setEndYear(Number(e.target.value))}
                className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            {isEdit && onRequestDelete ? (
              <button
                type="button"
                onClick={onRequestDelete}
                className="rounded-md border border-red-700 bg-red-900/30 px-4 py-2 text-sm font-medium text-red-400 hover:bg-red-900/60"
              >
                Delete…
              </button>
            ) : (
              <span />
            )}
            <button
              type="submit"
              disabled={loading}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? "Saving…" : isEdit ? "Save Changes" : "Add Rule"}
            </button>
          </div>
        </form>)}

        {activeTab === "schedule" && (
          <ScheduleTab
            startYear={startYear}
            endYear={endYear}
            initialOverrides={stagedSchedule}
            onSave={async (overrides) => {
              if (editing) {
                await fetch(`/api/clients/${clientId}/savings-rules/${editing.id}/schedule`, {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ overrides }),
                });
              }
              setStagedSchedule(overrides);
              setHasSchedule(overrides.length > 0);
            }}
            onClear={async () => {
              if (editing) {
                await fetch(`/api/clients/${clientId}/savings-rules/${editing.id}/schedule`, { method: "DELETE" });
              }
              setStagedSchedule([]);
              setHasSchedule(false);
            }}
          />
        )}
      </div>
    </div>
  );
}

// ── Main View ─────────────────────────────────────────────────────────────────

export default function IncomeExpensesView({
  clientId,
  initialIncomes,
  initialExpenses,
  initialSavingsRules,
  accounts,
  entities,
  clientInfo,
  ownerNames,
  incomeSchedules,
  expenseSchedules,
  savingsSchedules,
}: IncomeExpensesViewProps) {
  const [incomeList, setIncomeList] = useState<Income[]>(initialIncomes);
  const [expenseList, setExpenseList] = useState<Expense[]>(initialExpenses);
  const [savingsRuleList, setSavingsRuleList] = useState<SavingsRule[]>(initialSavingsRules);

  // Edit mode per section
  const [incomeEdit, setIncomeEdit] = useState(false);
  const [expenseEdit, setExpenseEdit] = useState(false);
  const [savingsEdit, setSavingsEdit] = useState(false);

  // Dialog state — a single dialog per entity type, controlled by (open, editing, defaultType)
  const [incomeDialog, setIncomeDialog] = useState<{
    open: boolean;
    editing?: Income;
    defaultType?: IncomeType;
  }>({ open: false });
  const [expenseDialog, setExpenseDialog] = useState<{
    open: boolean;
    editing?: Expense;
    defaultType?: ExpenseType;
  }>({ open: false });
  const [savingsDialog, setSavingsDialog] = useState<{ open: boolean; editing?: SavingsRule }>({ open: false });

  // Delete confirms
  const [deletingIncome, setDeletingIncome] = useState<Income | null>(null);
  const [deletingExpense, setDeletingExpense] = useState<Expense | null>(null);
  const [deletingSavings, setDeletingSavings] = useState<SavingsRule | null>(null);

  const accountMap = Object.fromEntries(accounts.map((a) => [a.id, a]));
  const entityMap = Object.fromEntries((entities ?? []).map((e) => [e.id, e]));

  const planStart = clientInfo?.planStartYear;
  const planEnd = clientInfo?.planEndYear;

  // Totals (household only = exclude out-of-estate)
  const householdIncome = incomeList.filter((i) => !i.ownerEntityId).reduce((s, i) => s + Number(i.annualAmount), 0);
  const householdExpense = expenseList.filter((e) => !e.ownerEntityId).reduce((s, e) => s + Number(e.annualAmount), 0);
  const netCashFlow = householdIncome - householdExpense;

  const outOfEstateIncome = incomeList.filter((i) => i.ownerEntityId).reduce((s, i) => s + Number(i.annualAmount), 0);
  const outOfEstateExpense = expenseList.filter((e) => e.ownerEntityId).reduce((s, e) => s + Number(e.annualAmount), 0);

  async function performDelete(url: string) {
    const res = await fetch(url, { method: "DELETE" });
    if (!res.ok && res.status !== 204) {
      const json = await res.json().catch(() => ({}));
      alert(json.error ?? "Failed to delete");
      return false;
    }
    return true;
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="Income" value={fmt(householdIncome)} accent="text-gray-100" />
        <Kpi label="Expenses" value={fmt(householdExpense)} accent="text-gray-100" />
        <Kpi
          label="Net Cash Flow"
          value={(netCashFlow >= 0 ? "+" : "") + fmt(netCashFlow)}
          accent={netCashFlow >= 0 ? "text-green-500" : "text-red-400"}
        />
        <Kpi
          label="Out of estate"
          value={fmt(outOfEstateIncome - outOfEstateExpense)}
          accent="text-amber-300"
          subtitle={
            outOfEstateIncome || outOfEstateExpense
              ? `${fmt(outOfEstateIncome)} in / ${fmt(outOfEstateExpense)} out`
              : "—"
          }
        />
      </div>

      {/* Income + Expenses two-column */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Income */}
        <Panel>
          <SectionHeader
            title="Income"
            subtitle={fmt(householdIncome) + " household · " + incomeList.length + " entries"}
            actions={
              <>
                {incomeList.length > 0 && <EditToggle on={incomeEdit} onToggle={() => setIncomeEdit((v) => !v)} />}
                <button
                  onClick={() => setIncomeDialog({ open: true, defaultType: "salary" })}
                  className="rounded-md bg-blue-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-blue-700"
                >
                  + Add
                </button>
              </>
            }
          />

          {incomeList.length === 0 ? (
            <EmptyRow message="No income entries yet." />
          ) : (
            INCOME_GROUPS.map((group) => {
              const items = incomeList.filter((i) => group.types.includes(i.type));
              if (items.length === 0) return null;
              const subtotal = items.reduce((s, i) => s + Number(i.annualAmount), 0);
              return (
                <Group
                  key={group.label}
                  label={group.label}
                  total={fmt(subtotal)}
                  onAdd={() => setIncomeDialog({ open: true, defaultType: group.types[0] })}
                >
                  {items.map((income) => {
                    const entityName = income.ownerEntityId ? entityMap[income.ownerEntityId]?.name : undefined;
                    return (
                      <Row
                        key={income.id}
                        onClick={() => !incomeEdit && setIncomeDialog({ open: true, editing: income })}
                        editMode={incomeEdit}
                        onDelete={() => setDeletingIncome(income)}
                        label={income.name}
                        meta={[
                          entityName ?? individualOwnerLabel(income.owner, ownerNames),
                          income.claimingAge ? `Claim @ ${income.claimingAge}` : null,
                          income.linkedEntityId && accountMap[income.linkedEntityId]
                            ? accountMap[income.linkedEntityId].name
                            : null,
                        ]}
                        starts={yearsDescriptor(income.startYear, income.endYear, planStart, planEnd)}
                        value={fmt(income.annualAmount)}
                        outOfEstate={Boolean(income.ownerEntityId)}
                      />
                    );
                  })}
                </Group>
              );
            })
          )}
        </Panel>

        {/* Expenses */}
        <Panel>
          <SectionHeader
            title="Expenses"
            subtitle={fmt(householdExpense) + " household · " + expenseList.length + " entries"}
            actions={
              <>
                {expenseList.length > 0 && <EditToggle on={expenseEdit} onToggle={() => setExpenseEdit((v) => !v)} />}
                <button
                  onClick={() => setExpenseDialog({ open: true, defaultType: "living" })}
                  className="rounded-md bg-blue-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-blue-700"
                >
                  + Add
                </button>
              </>
            }
          />

          {expenseList.length === 0 ? (
            <EmptyRow message="No expense entries yet." />
          ) : (
            EXPENSE_GROUPS.map((group) => {
              const items = expenseList.filter((e) => group.types.includes(e.type));
              if (items.length === 0) return null;
              const subtotal = items.reduce((s, e) => s + Number(e.annualAmount), 0);
              return (
                <Group
                  key={group.label}
                  label={group.label}
                  total={fmt(subtotal)}
                  onAdd={() => setExpenseDialog({ open: true, defaultType: group.types[0] })}
                >
                  {items.map((expense) => {
                    const entityName = expense.ownerEntityId ? entityMap[expense.ownerEntityId]?.name : undefined;
                    return (
                      <Row
                        key={expense.id}
                        onClick={() => !expenseEdit && setExpenseDialog({ open: true, editing: expense })}
                        editMode={expenseEdit}
                        onDelete={() => setDeletingExpense(expense)}
                        label={expense.name}
                        meta={[entityName ?? null]}
                        starts={yearsDescriptor(expense.startYear, expense.endYear, planStart, planEnd)}
                        value={fmt(expense.annualAmount)}
                        outOfEstate={Boolean(expense.ownerEntityId)}
                      />
                    );
                  })}
                </Group>
              );
            })
          )}
        </Panel>
      </div>

      {/* Savings Rules */}
      <Panel>
        <SectionHeader
          title="Savings & Contributions"
          subtitle={`${savingsRuleList.length} rule${savingsRuleList.length === 1 ? "" : "s"}`}
          actions={
            <>
              {savingsRuleList.length > 0 && (
                <EditToggle on={savingsEdit} onToggle={() => setSavingsEdit((v) => !v)} />
              )}
              <button
                onClick={() => setSavingsDialog({ open: true })}
                disabled={accounts.length === 0}
                className="rounded-md bg-blue-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-blue-700 disabled:opacity-40"
              >
                + Add
              </button>
            </>
          }
        />

        {savingsRuleList.length === 0 ? (
          <EmptyRow
            message={accounts.length === 0 ? "Add accounts first, then set up contribution rules." : "No savings rules yet."}
          />
        ) : (
          <div>
            {/* One sub-group per account */}
            {accounts
              .filter((a) => savingsRuleList.some((r) => r.accountId === a.id))
              .map((a) => {
                const rules = savingsRuleList.filter((r) => r.accountId === a.id);
                return (
                  <div key={a.id} className="border-b border-gray-800 last:border-0">
                    <div className="bg-gray-900/70 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-gray-300">
                      {a.name}
                    </div>
                    <div className="divide-y divide-gray-800">
                      {rules.map((rule) => (
                        <Row
                          key={rule.id}
                          onClick={() => !savingsEdit && setSavingsDialog({ open: true, editing: rule })}
                          editMode={savingsEdit}
                          onDelete={() => setDeletingSavings(rule)}
                          label={
                            rule.employerMatchAmount
                              ? `Contribution + ${fmt(rule.employerMatchAmount)} match/yr`
                              : rule.employerMatchPct
                              ? `Contribution + ${(Number(rule.employerMatchPct) * 100).toFixed(0)}% match`
                              : "Contribution"
                          }
                          meta={[
                            rule.employerMatchCap ? `Cap ${(Number(rule.employerMatchCap) * 100).toFixed(1)}%` : null,
                            rule.annualLimit ? `Limit ${fmt(rule.annualLimit)}` : null,
                          ]}
                          starts={yearsDescriptor(rule.startYear, rule.endYear, planStart, planEnd)}
                          value={`${fmt(rule.annualAmount)}/yr`}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </Panel>

      {/* Dialogs */}
      <IncomeDialog
        clientId={clientId}
        accounts={accounts}
        entities={entities}
        clientInfo={clientInfo}
        ownerNames={ownerNames}
        open={incomeDialog.open}
        onOpenChange={(o) => setIncomeDialog((d) => ({ ...d, open: o, editing: o ? d.editing : undefined }))}
        defaultType={incomeDialog.defaultType}
        editing={incomeDialog.editing}
        onSaved={(income, mode) => {
          if (mode === "create") setIncomeList((prev) => [...prev, income]);
          else setIncomeList((prev) => prev.map((i) => (i.id === income.id ? income : i)));
        }}
        onRequestDelete={() => {
          if (incomeDialog.editing) setDeletingIncome(incomeDialog.editing);
        }}
        schedule={incomeDialog.editing ? incomeSchedules[incomeDialog.editing.id] : undefined}
      />

      <ExpenseDialog
        clientId={clientId}
        accounts={accounts}
        entities={entities}
        clientInfo={clientInfo}
        open={expenseDialog.open}
        onOpenChange={(o) => setExpenseDialog((d) => ({ ...d, open: o, editing: o ? d.editing : undefined }))}
        defaultType={expenseDialog.defaultType}
        editing={expenseDialog.editing}
        onSaved={(expense, mode) => {
          if (mode === "create") setExpenseList((prev) => [...prev, expense]);
          else setExpenseList((prev) => prev.map((e) => (e.id === expense.id ? expense : e)));
        }}
        onRequestDelete={() => {
          if (expenseDialog.editing) setDeletingExpense(expenseDialog.editing);
        }}
        schedule={expenseDialog.editing ? expenseSchedules[expenseDialog.editing.id] : undefined}
      />

      <SavingsRuleDialog
        clientId={clientId}
        accounts={accounts}
        open={savingsDialog.open}
        onOpenChange={(o) => setSavingsDialog((d) => ({ ...d, open: o, editing: o ? d.editing : undefined }))}
        editing={savingsDialog.editing}
        onSaved={(rule, mode) => {
          if (mode === "create") setSavingsRuleList((prev) => [...prev, rule]);
          else setSavingsRuleList((prev) => prev.map((r) => (r.id === rule.id ? rule : r)));
        }}
        onRequestDelete={() => {
          if (savingsDialog.editing) setDeletingSavings(savingsDialog.editing);
        }}
        schedule={savingsDialog.editing ? savingsSchedules[savingsDialog.editing.id] : undefined}
      />

      {/* Delete confirms */}
      <ConfirmDeleteDialog
        open={!!deletingIncome}
        title="Delete Income"
        message={deletingIncome ? `Delete "${deletingIncome.name}"?` : ""}
        onCancel={() => setDeletingIncome(null)}
        onConfirm={async () => {
          if (!deletingIncome) return;
          const ok = await performDelete(`/api/clients/${clientId}/incomes/${deletingIncome.id}`);
          if (ok) {
            setIncomeList((prev) => prev.filter((i) => i.id !== deletingIncome.id));
            setIncomeDialog({ open: false });
            setDeletingIncome(null);
          }
        }}
      />

      <ConfirmDeleteDialog
        open={!!deletingExpense}
        title="Delete Expense"
        message={deletingExpense ? `Delete "${deletingExpense.name}"?` : ""}
        onCancel={() => setDeletingExpense(null)}
        onConfirm={async () => {
          if (!deletingExpense) return;
          const ok = await performDelete(`/api/clients/${clientId}/expenses/${deletingExpense.id}`);
          if (ok) {
            setExpenseList((prev) => prev.filter((e) => e.id !== deletingExpense.id));
            setExpenseDialog({ open: false });
            setDeletingExpense(null);
          }
        }}
      />

      <ConfirmDeleteDialog
        open={!!deletingSavings}
        title="Delete Savings Rule"
        message={
          deletingSavings
            ? `Delete savings rule for "${accountMap[deletingSavings.accountId]?.name ?? "account"}"?`
            : ""
        }
        onCancel={() => setDeletingSavings(null)}
        onConfirm={async () => {
          if (!deletingSavings) return;
          const ok = await performDelete(`/api/clients/${clientId}/savings-rules/${deletingSavings.id}`);
          if (ok) {
            setSavingsRuleList((prev) => prev.filter((r) => r.id !== deletingSavings.id));
            setSavingsDialog({ open: false });
            setDeletingSavings(null);
          }
        }}
      />

    </div>
  );
}

// ── Layout atoms ──────────────────────────────────────────────────────────────

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

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="overflow-hidden rounded-lg border border-gray-800 bg-gray-900/50">{children}</div>;
}

function Group({
  label,
  total,
  onAdd,
  children,
}: {
  label: string;
  total: string;
  onAdd: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-gray-800 last:border-0">
      <div className="flex items-center justify-between bg-gray-900/70 px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-300">{label}</span>
          <AddGroupButton onClick={onAdd} label={`Add to ${label}`} />
        </div>
        <span className="text-[11px] text-gray-500">{total}</span>
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
  meta,
  starts,
  value,
  outOfEstate,
}: {
  onClick: () => void;
  editMode: boolean;
  onDelete: () => void;
  label: string;
  meta?: (string | null | undefined)[];
  starts?: string;
  value: string;
  outOfEstate?: boolean;
}) {
  const metaLine = (meta ?? []).filter(Boolean).join(" · ");
  return (
    <div
      onClick={onClick}
      className={`flex cursor-pointer items-center justify-between gap-3 px-4 py-2 hover:bg-gray-800/60 ${
        outOfEstate ? "bg-amber-950/10" : ""
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-gray-100">{label}</span>
          {outOfEstate && (
            <span className="rounded-sm bg-amber-900/30 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
              OOE
            </span>
          )}
        </div>
        {metaLine && <div className="truncate text-[11px] text-gray-500">{metaLine}</div>}
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        {starts && (
          <span className="min-w-[72px] text-right text-[11px] text-gray-500">{starts}</span>
        )}
        <span className="min-w-[88px] text-right text-sm font-medium text-gray-100">{value}</span>
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
