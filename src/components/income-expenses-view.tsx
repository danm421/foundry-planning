"use client";

import { useEffect, useRef, useState } from "react";
import GrowthSourceRadio from "./forms/growth-source-radio";
import { DedicatedFundingPicker } from "./forms/dedicated-funding-picker";
import { PaymentMonthSelect } from "./forms/payment-month-select";
import { StateSelect } from "@/components/state-select";
import SavingsRuleDialog from "./forms/savings-rule-dialog";
import SavingsRulesList from "./forms/savings-rules-list";
import InlineYearCell from "./forms/inline-year-cell";
import FlowGrowthCell from "./forms/flow-growth-cell";
import ConfirmDeleteDialog from "./confirm-delete-dialog";
import MilestoneYearPicker from "./milestone-year-picker";
import ScheduleTab from "./schedule-tab";
import { CurrencyInput } from "./currency-input";
import { PercentInput } from "./percent-input";
import type { YearRef, ClientMilestones } from "@/lib/milestones";
import { coerceYearRef, defaultIncomeRefs, defaultExpenseRefs, resolveMilestone } from "@/lib/milestones";
import {
  buildFlowScenarioDesiredFields,
  flowAmountPatch,
  flowYearPatch,
  type FlowPatch,
} from "@/lib/inline-edit/flow-write";
import { livingSlotRank } from "@/lib/living-slot-order";
import { individualOwnerLabel, type OwnerNames } from "@/lib/owner-labels";
import { isGoalExpense, educationGoalYears, EDUCATION_GOAL_YEARS } from "@/lib/goals";
import { isTodaysDollars } from "@/lib/todays-dollars";
import type { ClientInfo as EngineClientInfo, PlanSettings, Income as EngineIncome } from "@/engine/types";
import type { IncomeTaxType } from "@/engine/tax-adjustments";
import type { AccountOwner } from "@/engine/ownership";
import { SocialSecurityCard } from "./social-security-card";
import { useScenarioWriter } from "@/hooks/use-scenario-writer";
import { useClientAccess } from "./client-access-provider";
import Row from "@/components/income-expenses/row";
import Group from "@/components/income-expenses/group";
import { FieldTooltip } from "@/components/forms/field-tooltip";
import { isRetirementLivingExpense } from "@/lib/solver/living-expense";
import { toSalaryOptions } from "@/lib/savings/salary-options";

// ── Types ─────────────────────────────────────────────────────────────────────

type IncomeType = "salary" | "social_security" | "business" | "deferred" | "capital_gains" | "trust" | "other";
type ExpenseType = "living" | "other" | "insurance" | "education";
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
  claimingAgeMonths?: number | null;
  /** Rides along with the claim-age pair — `SocialSecurityCard` / the SS dialog
   *  read it, and a row missing it renders as an explicit age it never chose. */
  claimingAgeMode?: string | null;
  growthRate: string;
  growthSource?: string | null;
  ownerEntityId?: string | null;
  ownerAccountId?: string | null;
  cashAccountId?: string | null;
  inflationStartYear?: number | null;
  startYearRef?: string | null;
  endYearRef?: string | null;
  taxType?: string | null;
  ssBenefitMode?: string | null;
  piaMonthly?: string | null;
  linkedPropertyId?: string | null;
  survivorshipPct?: string | null;
  survivorAnnuityQtipElectOut?: boolean | null;
  /** "Paid in" month (1-12); null spreads the year evenly. Presentation only. */
  paymentMonth?: number | null;
}

const INCOME_TAX_TYPE_LABELS: Record<IncomeTaxType, string> = {
  earned_income: "Earned Income",
  ordinary_income: "Ordinary Income",
  dividends: "Dividends",
  capital_gains: "Capital Gains",
  qbi: "QBI",
  tax_exempt: "Other tax-free income",
  muni_interest: "Municipal bond interest",
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
  growthSource?: string | null;
  ownerEntityId?: string | null;
  ownerAccountId?: string | null;
  cashAccountId?: string | null;
  inflationStartYear?: number | null;
  startYearRef?: string | null;
  endYearRef?: string | null;
  deductionType?: string | null;
  endsAtMedicareEligibilityOwner?: "client" | "spouse" | null;
  isDefault?: boolean;
  payShortfallOutOfPocket?: boolean;
  institutionState?: string | null;
  institutionName?: string | null;
  forFamilyMemberId?: string | null;
  dedicatedAccountIds?: string[];
  isGoal?: boolean;
  absorbsRemainingCashFlow?: boolean;
  /** "Paid in" month (1-12); null spreads the year evenly. Presentation only. */
  paymentMonth?: number | null;
}

interface SavingsRule {
  id: string;
  accountId: string;
  annualAmount: string;
  annualPercent?: string | null;
  isDeductible?: boolean;
  applyContributionLimit?: boolean;
  contributeMax?: boolean;
  startYear: number;
  endYear: number;
  growthRate?: string | null;
  growthSource?: string | null;
  employerMatchPct: string | null;
  employerMatchCap: string | null;
  employerMatchAmount: string | null;
  startYearRef?: string | null;
  endYearRef?: string | null;
  salaryBasis?: string | null;
  salaryIncomeIds?: string[] | null;
}

interface Account {
  id: string;
  name: string;
  category: string;
  subType: string;
  value?: number;
  isDefaultChecking?: boolean | null;
  ownerEntityId?: string | null;
  ownerFamilyMemberIds?: string[];
  /** Ownership rows verbatim, for the savings-rule year defaults. */
  owners?: AccountOwner[];
  /** 529 only — who the money is FOR. Kept out of `ownerFamilyMemberIds`
   *  because a 529's owners are deliberately empty (out of estate). */
  beneficiaryFamilyMemberId?: string | null;
  beneficiaryName?: string | null;
}

interface Entity {
  id: string;
  name: string;
}

interface FamilyMember {
  id: string;
  firstName: string;
  lastName?: string | null;
  role: string;
  dateOfBirth?: string | null;
}

interface ClientInfo {
  clientRetirementYear: number;
  clientEndYear: number;
  spouseRetirementYear?: number;
  spouseEndYear?: number;
  planStartYear: number;
  planEndYear: number;
  milestones?: ClientMilestones;
  clientDob?: string | null;
  spouseDob?: string | null;
}

type ScheduleMap = Record<string, { year: number; amount: number }[]>;

export interface IncomeExpensesViewProps {
  clientId: string;
  initialIncomes: Income[];
  initialExpenses: Expense[];
  initialSavingsRules: SavingsRule[];
  accounts: Account[];
  entities?: Entity[];
  familyMembers?: FamilyMember[];
  clientInfo?: ClientInfo;
  ownerNames: OwnerNames;
  incomeSchedules: ScheduleMap;
  expenseSchedules: ScheduleMap;
  savingsSchedules: ScheduleMap;
  /**
   * Per-row scenario-edit field sets, keyed by income / expense id, built
   * SERVER-side from the EFFECTIVE ENGINE rows.
   *
   * Not derivable here. `initialIncomes` / `initialExpenses` are
   * `incomeEngineToView` / `expenseEngineToView` output — strict subsets of the
   * engine types — and the fields they drop (`isSelfEmployment`,
   * `endsAtMedicareEligibilityOwner`) are ones real producers override. A
   * scenario edit's payload is stored as a WHOLESALE REPLACE, so a key missing
   * from `desiredFields` doesn't just go unwritten: the scenario's existing
   * override for it is deleted. `lib/inline-edit/flow-write.ts` owns the rule.
   *
   * A row with no entry here refuses its inline write — see `saveIncomeField`.
   */
  flowScenarioFields: Record<string, Record<string, unknown>>;
  resolvedInflationRate: number;
  ssClientInfo?: EngineClientInfo;
  ssPlanSettings?: PlanSettings;
  /**
   * Optional callback to open the entity edit dialog from the "Linked Entities"
   * section. When omitted, those rows are still rendered (read-only) but clicks
   * fall through. Phase 2 polish: wire this up from the consuming page.
   */
  onOpenEntity?: (entityId: string, tab?: "details" | "flows" | "assets" | "transfers" | "notes") => void;
  /** "wizard" hides the page-level KPI strip; everything else renders as today. */
  embed?: "page" | "wizard";
  /**
   * Which slice of the flows this render owns. "cash-flow" (the default) is the
   * full income / expense / savings layout; "goals" renders ONLY the goal
   * expenses — education plus anything flagged `isGoal` — so the guided-setup
   * wizard can give goals their own step. Mirrors BalanceSheetView's `section`.
   */
  section?: "cash-flow" | "goals";
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

function PillToggle({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        "px-3 py-1.5 text-[12px] font-medium rounded-[var(--radius-sm)] border transition-colors " +
        (active
          ? "bg-accent text-accent-on border-accent"
          : "bg-card-2 text-ink-3 border-hair hover:border-hair-2 hover:text-ink")
      }
    >
      {label}
    </button>
  );
}

const INCOME_GROUPS: { label: string; types: IncomeType[] }[] = [
  { label: "Salaries", types: ["salary"] },
  { label: "Business", types: ["business"] },
  { label: "Deferred", types: ["deferred"] },
  { label: "Capital Gains", types: ["capital_gains"] },
  { label: "Trust", types: ["trust"] },
  { label: "Other Income", types: ["other"] },
];

const EXPENSE_GROUPS: { label: string; types: ExpenseType[] }[] = [
  { label: "Living Expenses", types: ["living"] },
  { label: "Insurance", types: ["insurance"] },
  { label: "Education", types: ["education"] },
  { label: "Other Expenses", types: ["other"] },
];

const INCOME_TYPE_LABELS: Partial<Record<IncomeType, string>> = {
  salary: "Salary",
  business: "Business",
  deferred: "Deferred",
  capital_gains: "Capital Gains",
  trust: "Trust",
  other: "Other",
};

function makeDefaultIncomeName(owner: Owner, type: IncomeType, ownerNames: OwnerNames): string {
  const label = INCOME_TYPE_LABELS[type];
  if (!label) return "";
  const ownerFirst = individualOwnerLabel(owner, ownerNames).split(" ")[0];
  return `${ownerFirst} - ${label}`;
}


/**
 * The six Social-Security anchors. Mirrors the `includeSSRefs` branch of
 * `availableRefs` (`lib/milestones.ts`), the only other place that enumerates
 * them.
 */
const SS_YEAR_REFS: ReadonlySet<YearRef> = new Set<YearRef>([
  "client_ss_62",
  "client_ss_fra",
  "client_ss_70",
  "spouse_ss_62",
  "spouse_ss_fra",
  "spouse_ss_70",
]);

/**
 * `showSSRefs` has to track the row's REF, not its income type.
 *
 * With an SS-anchored ref and `showSSRefs=false`, `availableRefs` omits that ref
 * and the open `<select>`'s value matches no `<option>`. Read mode still looks
 * right, because `InlineYearCell`'s display comes from `YEAR_REF_LABELS`
 * independently — so the defect is invisible until the dropdown is opened.
 *
 * This page never CREATES an SS anchor (all four dialog pickers pass
 * `showSSRefs={false}`) and no `social_security` row reaches a `Row` at all —
 * `INCOME_GROUPS` has no such group and SS renders in `SocialSecurityCard`. But
 * the Solver and the importer do write these refs, so read-back has to cope.
 */
const isSsRef = (ref: YearRef | null): boolean => ref != null && SS_YEAR_REFS.has(ref);

/**
 * The year cell for a page with no milestones to anchor against.
 *
 * A span rather than `undefined`: `Row` renders a slot's fixed-width cell only
 * when the slot is present, so a missing one collapses the column and shifts
 * every following cell. Styling matches `InlineYearCell`'s own read mode.
 */
function PlainYearCell({ year }: { year: number }) {
  return <span className="tabular text-[11px] text-ink-3">{year}</span>;
}

// ── Shared atoms ──────────────────────────────────────────────────────────────

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
        {subtitle && <p className="text-xs text-gray-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

function EditToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={`rounded-md border px-2.5 py-1 text-xs font-medium ${
        on
          ? "border-accent bg-accent/15 text-accent-ink"
          : "border-gray-700 bg-gray-900 text-gray-300 hover:bg-gray-800"
      }`}
    >
      {on ? "Done" : "Edit"}
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
 * Pick the cash account an income deposits into. Shows every cash-category
 * account; entity-owned accounts are grouped under the entity so advisors can
 * pick a trust's cash without hunting for it. The empty value means "use the
 * default checking for this owner".
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
        className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
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

// ── Business Owner Picker ─────────────────────────────────────────────────────

interface BusinessOwnerSelectProps {
  id: string;
  accounts: Account[];
  value: string | null;
  onChange: (v: string | null) => void;
}

/**
 * Optional "Owned by business" selector. When set, the income/expense is
 * routed to the chosen business asset's books (Phase 2). Mutually exclusive
 * with `ownerEntityId` (trust ownership) — but that path is not currently
 * editable from this dialog, so we only need to show businesses here.
 */
function BusinessOwnerSelect({ id, accounts, value, onChange }: BusinessOwnerSelectProps) {
  const businessAccounts = accounts.filter((a) => a.category === "business");
  if (businessAccounts.length === 0) return null;

  return (
    <div>
      <label className="block text-sm font-medium text-gray-300" htmlFor={id}>
        Owned by business (optional)
      </label>
      <select
        id={id}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
      >
        <option value="">— None —</option>
        {businessAccounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
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
  resolvedInflationRate: number;
}

function IncomeDialog({
  clientId,
  defaultType = "salary",
  accounts,
  clientInfo,
  ownerNames,
  open,
  onOpenChange,
  editing,
  onSaved,
  onRequestDelete,
  schedule,
  resolvedInflationRate,
}: IncomeDialogProps) {
  const writer = useScenarioWriter(clientId);
  type TabId = "details" | "schedule";
  const [activeTab, setActiveTab] = useState<TabId>("details");
  const [hasSchedule, setHasSchedule] = useState((schedule ?? []).length > 0);
  const [stagedSchedule, setStagedSchedule] = useState<{ year: number; amount: number }[]>(schedule ?? []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<IncomeType>(editing?.type ?? defaultType);
  const [owner, setOwner] = useState<Owner>(editing?.owner ?? "client");
  const [cashAccountId, setCashAccountId] = useState<string>(editing?.cashAccountId ?? "");
  const [ownerAccountId, setOwnerAccountId] = useState<string | null>(editing?.ownerAccountId ?? null);
  const [linkedPropertyId, setLinkedPropertyId] = useState<string | null>(
    editing?.linkedPropertyId ?? null,
  );
  const realEstateAccounts = accounts.filter((a) => a.category === "real_estate");
  const linkedProperty = realEstateAccounts.find((a) => a.id === linkedPropertyId) ?? null;
  const planStartYear = clientInfo?.planStartYear ?? new Date().getFullYear();
  const [todaysDollars, setTodaysDollars] = useState<boolean>(
    editing ? isTodaysDollars(editing.inflationStartYear, editing.startYear) : true
  );
  // New incomes default to inflation growth (advisor convention — most income
  // streams are modeled to inflate with cost of living unless explicitly set).
  const [growthSource, setGrowthSource] = useState<"custom" | "inflation">(
    editing ? (editing.growthSource === "inflation" ? "inflation" : "custom") : "inflation"
  );
  const [growthRateDisplay, setGrowthRateDisplay] = useState<string>(
    String(pctFromDecimal(editing?.growthRate, 3))
  );
  // Stored as a whole-number percent for display (e.g. "50"); converted to a
  // fraction string (e.g. "0.5") on submit — schema expects a fraction in [0,1].
  const [survivorshipPctInput, setSurvivorshipPctInput] = useState<string>(
    editing?.survivorshipPct != null ? String(Math.round(Number(editing.survivorshipPct) * 100)) : "",
  );
  const [qtipElectOut, setQtipElectOut] = useState<boolean>(
    editing?.survivorAnnuityQtipElectOut ?? false,
  );
  const [paymentMonth, setPaymentMonth] = useState<number | null>(editing?.paymentMonth ?? null);
  const currentYear = new Date().getFullYear();
  const isEdit = Boolean(editing);
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
    editing?.startYear ?? (startYearRef && clientInfo?.milestones ? resolveMilestone(startYearRef, clientInfo.milestones, "start") ?? currentYear : currentYear)
  );
  const [endYear, setEndYear] = useState<number>(
    editing?.endYear ?? (endYearRef && clientInfo?.milestones ? resolveMilestone(endYearRef, clientInfo.milestones, "end") ?? (currentYear + 20) : currentYear + 20)
  );
  const [name, setName] = useState<string>(
    editing?.name ?? makeDefaultIncomeName(owner, type, ownerNames)
  );
  const nameTouchedRef = useRef<boolean>(Boolean(editing?.name));
  const startYearTouchedRef = useRef<boolean>(Boolean(editing));
  const endYearTouchedRef = useRef<boolean>(Boolean(editing));

  // In create mode, snap the name + year refs to sensible defaults when the
  // user switches owner or type — unless they've explicitly edited those fields.
  useEffect(() => {
    if (isEdit) return;
    if (!nameTouchedRef.current) {
      setName(makeDefaultIncomeName(owner, type, ownerNames));
    }
    const refs = defaultIncomeRefs(type, owner);
    if (!startYearTouchedRef.current && refs.startYearRef) {
      setStartYearRef(refs.startYearRef);
      if (clientInfo?.milestones) {
        const y = resolveMilestone(refs.startYearRef, clientInfo.milestones, "start");
        if (y != null) setStartYear(y);
      }
    }
    if (!endYearTouchedRef.current && refs.endYearRef) {
      setEndYearRef(refs.endYearRef);
      if (clientInfo?.milestones) {
        const y = resolveMilestone(refs.endYearRef, clientInfo.milestones, "end");
        if (y != null) setEndYear(y);
      }
    }
  }, [owner, type, isEdit, ownerNames, clientInfo?.milestones]);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const data = new FormData(e.currentTarget);

    let submitStartYear: string;
    let submitEndYear: string;
    submitStartYear = String(startYear);
    submitEndYear = String(endYear);

    const body = {
      type: data.get("type") as string,
      name: data.get("name") as string,
      annualAmount: data.get("annualAmount") as string,
      startYear: submitStartYear,
      endYear: submitEndYear,
      growthRate: String(Number(growthRateDisplay) / 100),
      growthSource,
      owner: data.get("owner") as string,
      cashAccountId: cashAccountId || null,
      ownerAccountId: ownerAccountId ?? null,
      // "Today's dollars" mode inflates the amount from plan start through the
      // entry's startYear so retirement-era amounts can be entered in current
      // purchasing power. Null means inflate only from startYear onward.
      inflationStartYear: todaysDollars ? planStartYear : null,
      startYearRef,
      endYearRef,
      taxType,
      linkedPropertyId: type === "other" ? (linkedPropertyId || null) : null,
      // Re-guard MUST match the field's render condition exactly (deferred +
      // single owner) — otherwise switching owner to Joint after typing a value
      // hides the field but still leaks the stale fraction into the payload.
      survivorshipPct:
        type === "deferred" &&
        (owner === "client" || owner === "spouse") &&
        survivorshipPctInput.trim() !== ""
          ? String(Number(survivorshipPctInput) / 100)
          : null,
      survivorAnnuityQtipElectOut:
        type === "deferred" && (owner === "client" || owner === "spouse") ? qtipElectOut : null,
      paymentMonth,
    };

    try {
      const url = isEdit
        ? `/api/clients/${clientId}/incomes/${editing!.id}`
        : `/api/clients/${clientId}/incomes`;
      // For scenario-mode `add` we mint a uuid up-front so we can read it back
      // without parsing the response (which is `{ ok, targetId }` from the
      // unified writer route, not the full row).
      const newId = !isEdit
        ? typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `tmp-${Date.now()}`
        : editing!.id;
      const res = await writer.submit(
        isEdit
          ? {
              op: "edit",
              targetKind: "income",
              targetId: editing!.id,
              desiredFields: body,
            }
          : {
              op: "add",
              targetKind: "income",
              entity: { id: newId, ...body },
            },
        { url, method: isEdit ? "PUT" : "POST", body },
      );

      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? "Failed to save income");
      }

      // Base mode returns the saved row; scenario mode returns `{ ok, targetId }`.
      // Synthesize a stub for the optimistic onSaved callback — router.refresh()
      // (run by the writer) reloads canonical state.
      const saved: Income = writer.scenarioActive
        ? ({ id: newId, ...body } as unknown as Income)
        : ((await res.json()) as Income);

      // On create: if a schedule was staged, persist it now that we have the ID.
      // Schedule overrides are out of v1 scenario scope, so we leave this as a
      // raw fetch — only meaningful in base mode (in scenario mode `saved.id`
      // points to the synthesized id, which has no base row to attach to).
      if (!isEdit && stagedSchedule.length > 0 && !writer.scenarioActive) {
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70" onClick={() => onOpenChange(false)} />
      <div className="relative z-10 flex max-h-[90vh] w-full max-w-lg flex-col rounded-lg border-2 border-ink-3 ring-1 ring-black/60 bg-gray-900 shadow-xl">
        <div className="flex shrink-0 items-center justify-between px-6 pt-6 pb-4">
          <h2 className="text-lg font-semibold text-gray-100">{isEdit ? "Edit Income" : "Add Income"}</h2>
          <button onClick={() => onOpenChange(false)} className="text-gray-300 hover:text-gray-200">
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        <div className="mx-6 flex shrink-0 border-b border-gray-700">
          <button type="button" onClick={() => setActiveTab("details")} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "details" ? "border-accent text-accent" : "border-transparent text-gray-300 hover:text-gray-200"}`}>Details</button>
          <button type="button" onClick={() => setActiveTab("schedule")} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "schedule" ? "border-accent text-accent" : "border-transparent text-gray-300 hover:text-gray-200"}`}>Schedule</button>
        </div>

        {activeTab === "details" && (<>
          <form id="income-form-fields" onSubmit={handleSubmit} className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
          {error && <p className="rounded bg-red-900/50 px-3 py-2 text-sm text-red-400">{error}</p>}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300" htmlFor="inc-type">Type</label>
              <select
                id="inc-type"
                name="type"
                required
                value={type}
                onChange={(e) => {
                  const next = e.target.value as IncomeType;
                  setType(next);
                  if (next !== "other") setLinkedPropertyId(null);
                }}
                className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
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
                className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              >
                {Object.entries(INCOME_TAX_TYPE_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>

            <div className={type === "other" ? "col-span-2 grid grid-cols-2 gap-4" : undefined}>
              <div>
                <label className="block text-sm font-medium text-gray-300">Owner</label>
                <input type="hidden" name="owner" value={owner} />
                <div
                  role="group"
                  aria-label="Owner"
                  className={`mt-1 flex flex-wrap gap-1.5${linkedProperty ? " pointer-events-none opacity-50" : ""}`}
                  aria-disabled={linkedProperty ? true : undefined}
                >
                  <PillToggle
                    label={ownerNames.clientName.split(" ")[0]}
                    active={owner === "client"}
                    onClick={() => setOwner("client")}
                  />
                  {ownerNames.spouseName && (
                    <PillToggle
                      label={ownerNames.spouseName.split(" ")[0]}
                      active={owner === "spouse"}
                      onClick={() => setOwner("spouse")}
                    />
                  )}
                  {ownerNames.spouseName && (
                    <PillToggle
                      label="Joint 50/50"
                      active={owner === "joint"}
                      onClick={() => setOwner("joint")}
                    />
                  )}
                </div>
                {linkedProperty && (
                  <p className="mt-1 text-xs text-gray-400">Owner follows {linkedProperty.name}.</p>
                )}
              </div>
              {type === "other" && (
                <div>
                  <label className="block text-sm font-medium text-gray-300" htmlFor="inc-linked-property">
                    Linked Property
                  </label>
                  <select
                    id="inc-linked-property"
                    value={linkedPropertyId ?? ""}
                    onChange={(e) => setLinkedPropertyId(e.target.value || null)}
                    className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 py-2 px-3 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  >
                    <option value="">None</option>
                    {realEstateAccounts.map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </div>
              )}
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
              value={name}
              onChange={(e) => { nameTouchedRef.current = true; setName(e.target.value); }}
              placeholder="e.g., Base Salary"
              className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            {hasSchedule ? (
              // When a custom schedule is active, the Annual Amount + Growth
              // inputs aren't used by the projection engine — surface that
              // state instead of showing fields the user can't influence.
              // The hidden input preserves any prior annualAmount on the row
              // so the API doesn't null it out on save (the form's FormData
              // is what the submit handler reads).
              <>
                <input type="hidden" name="annualAmount" value={String(editing?.annualAmount ?? 0)} />
                <div className="col-span-2 flex items-center justify-between rounded-md border border-accent/40 bg-accent/10 px-3 py-2.5">
                  <div>
                    <p className="text-sm font-medium text-accent">Using custom schedule</p>
                    <p className="text-xs text-gray-400">Annual amount and growth rate are overridden by the schedule.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab("schedule")}
                    className="text-xs font-medium text-accent underline hover:text-accent-deep"
                  >
                    View schedule
                  </button>
                </div>
              </>
            ) : (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-300" htmlFor="inc-amount">
                    Annual Amount ($) <span className="text-red-500">*</span>
                  </label>
                  <CurrencyInput
                    id="inc-amount"
                    name="annualAmount"
                    required
                    defaultValue={editing?.annualAmount ?? 0}
                    className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 py-2 pr-3 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300">Growth Rate</label>
                  <div className="mt-1">
                    <GrowthSourceRadio
                      value={growthSource}
                      customRate={growthRateDisplay}
                      resolvedInflationRate={resolvedInflationRate}
                      onChange={(next) => { setGrowthSource(next.value); setGrowthRateDisplay(next.customRate); }}
                    />
                  </div>
                </div>
                <label className="col-span-2 flex items-center gap-1.5 text-xs text-gray-300">
                  <input
                    type="checkbox"
                    checked={todaysDollars}
                    onChange={(e) => setTodaysDollars(e.target.checked)}
                    className="h-3 w-3 rounded border-gray-600 bg-gray-800 text-accent focus:ring-accent"
                  />
                  Amount in today&apos;s dollars (inflate from {planStartYear})
                </label>
              </>
            )}

            {clientInfo?.milestones ? (
              <>
                <MilestoneYearPicker
                  name="startYear"
                  id="inc-start"
                  value={startYear}
                  yearRef={startYearRef}
                  milestones={clientInfo.milestones}
                  showSSRefs={false}
                  onChange={(yr, ref) => { startYearTouchedRef.current = true; setStartYear(yr); setStartYearRef(ref); }}
                  label="Start Year"
                  clientFirstName={ownerNames.clientName.split(" ")[0]}
                  spouseFirstName={ownerNames.spouseName?.split(" ")[0]}
                  position="start"
                />
                <MilestoneYearPicker
                  name="endYear"
                  id="inc-end"
                  value={endYear}
                  yearRef={endYearRef}
                  milestones={clientInfo.milestones}
                  showSSRefs={false}
                  onChange={(yr, ref) => { endYearTouchedRef.current = true; setEndYear(yr); setEndYearRef(ref); }}
                  label="End Year"
                  clientFirstName={ownerNames.clientName.split(" ")[0]}
                  spouseFirstName={ownerNames.spouseName?.split(" ")[0]}
                  startYearForDuration={startYear}
                  position="end"
                />
              </>
            ) : (
              <>
                <div>
                  <label className="block text-xs font-medium text-gray-300" htmlFor="inc-start">
                    Start Year
                  </label>
                  <input
                    id="inc-start"
                    name="startYear"
                    type="number"
                    required
                    value={startYear}
                    onChange={(e) => { startYearTouchedRef.current = true; setStartYear(Number(e.target.value)); setStartYearRef(null); }}
                    className="mt-1 block w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-300" htmlFor="inc-end">
                    End Year
                  </label>
                  <input
                    id="inc-end"
                    name="endYear"
                    type="number"
                    required
                    value={endYear}
                    onChange={(e) => { endYearTouchedRef.current = true; setEndYear(Number(e.target.value)); setEndYearRef(null); }}
                    className="mt-1 block w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
              </>
            )}
          </div>

          {/* Full width, outside the Start/End Year grid: this is a whole-row
              setting, not a third cell of the two-column year block. */}
          <PaymentMonthSelect id="inc-payment-month" value={paymentMonth} onChange={setPaymentMonth} />

          {type === "deferred" && (owner === "client" || owner === "spouse") && (
            <div>
              <label className="block text-sm font-medium text-gray-300" htmlFor="inc-survivorship-pct">
                Survivor benefit %
              </label>
              <input
                id="inc-survivorship-pct"
                type="number"
                min={0}
                max={100}
                inputMode="numeric"
                value={survivorshipPctInput}
                onChange={(e) => setSurvivorshipPctInput(e.target.value)}
                placeholder="e.g. 50"
                className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <p className="mt-1 text-xs text-gray-400">
                Reduced % the surviving spouse keeps after the owner&apos;s death.
              </p>
            </div>
          )}

          {type === "deferred" && (owner === "client" || owner === "spouse") && (
            <div className="flex items-start gap-2">
              <input
                id="inc-qtip-elect-out"
                type="checkbox"
                checked={qtipElectOut}
                onChange={(e) => setQtipElectOut(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-gray-600 bg-gray-800 text-accent focus:ring-accent"
              />
              <label htmlFor="inc-qtip-elect-out" className="text-sm text-gray-300">
                Elect out of survivor-annuity marital deduction
                <span className="mt-0.5 block text-xs text-gray-400">
                  Default (unchecked): the annuity qualifies as deemed QTIP and is not
                  taxed in the first estate. Check to tax its present value at the first death.
                </span>
              </label>
            </div>
          )}

          <CashAccountPicker
            id="inc-cash"
            label="Deposits to"
            accounts={accounts}
            value={cashAccountId}
            onChange={setCashAccountId}
          />

          <BusinessOwnerSelect
            id="inc-owner-account"
            accounts={accounts}
            value={ownerAccountId}
            onChange={setOwnerAccountId}
          />

          </form>
          <div className="flex shrink-0 items-center justify-between border-t border-gray-800 bg-gray-900 px-6 py-4">
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
              form="income-form-fields"
              disabled={loading}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-on hover:bg-accent-ink disabled:opacity-50"
            >
              {loading ? "Saving…" : isEdit ? "Save Changes" : "Add Income"}
            </button>
          </div>
        </>)}

        {activeTab === "schedule" && (
          <div className="flex-1 overflow-y-auto px-6 py-4">
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
          </div>
        )}
      </div>
    </div>
  );
}

// ── Expense Dialog ────────────────────────────────────────────────────────────

interface ExpenseDialogProps {
  clientId: string;
  defaultType?: ExpenseType;
  /** Pre-ticks "Show as a goal" on a NEW row — set when the add came from the
   *  Goals step, where every row the advisor creates is a goal by intent. */
  defaultIsGoal?: boolean;
  accounts: Account[];
  entities?: Entity[];
  familyMembers?: FamilyMember[];
  clientInfo?: ClientInfo;
  ownerNames: OwnerNames;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: Expense;
  onSaved: (expense: Expense, mode: "create" | "edit") => void;
  onRequestDelete?: () => void;
  schedule?: { year: number; amount: number }[];
  resolvedInflationRate: number;
}

function ExpenseDialog({
  clientId,
  defaultType = "living",
  defaultIsGoal = false,
  accounts,
  familyMembers,
  clientInfo,
  ownerNames,
  open,
  onOpenChange,
  editing,
  onSaved,
  onRequestDelete,
  schedule,
  resolvedInflationRate,
}: ExpenseDialogProps) {
  const writer = useScenarioWriter(clientId);
  type ExpTabId = "details" | "schedule";
  const [activeTab, setActiveTab] = useState<ExpTabId>("details");
  const [hasSchedule, setHasSchedule] = useState((schedule ?? []).length > 0);
  const [stagedSchedule, setStagedSchedule] = useState<{ year: number; amount: number }[]>(schedule ?? []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<ExpenseType>(editing?.type ?? defaultType);
  const [deductionType, setDeductionType] = useState<string>(editing?.deductionType ?? "");
  const [ownerAccountId, setOwnerAccountId] = useState<string | null>(editing?.ownerAccountId ?? null);
  const [endsAtMedicareEligibilityOwner, setEndsAtMedicareEligibilityOwner] = useState<"client" | "spouse" | null>(
    editing?.endsAtMedicareEligibilityOwner ?? null
  );
  const [payOutOfPocket, setPayOutOfPocket] = useState<boolean>(editing?.payShortfallOutOfPocket ?? false);
  const [isGoal, setIsGoal] = useState<boolean>(editing?.isGoal ?? defaultIsGoal);
  const [absorbsRemaining, setAbsorbsRemaining] = useState<boolean>(
    editing?.absorbsRemainingCashFlow ?? false,
  );
  const [institutionState, setInstitutionState] = useState<string>(editing?.institutionState ?? "");
  const [institutionName, setInstitutionName] = useState<string>(editing?.institutionName ?? "");
  const [forFamilyMemberId, setForFamilyMemberId] = useState<string>(editing?.forFamilyMemberId ?? "");
  const [dedicatedAccountIds, setDedicatedAccountIds] = useState<string[]>(editing?.dedicatedAccountIds ?? []);
  const [name, setName] = useState<string>(editing?.name ?? "");
  const hasSpouse = Boolean(clientInfo?.spouseDob);
  const planStartYear = clientInfo?.planStartYear ?? new Date().getFullYear();
  const [todaysDollars, setTodaysDollars] = useState<boolean>(
    editing ? isTodaysDollars(editing.inflationStartYear, editing.startYear) : true
  );
  // New expenses default to inflation growth (advisor convention — planned
  // spending tracks inflation unless the advisor sets a custom rate). Editing an
  // existing row preserves whatever source it was saved with.
  const [growthSource, setGrowthSource] = useState<"custom" | "inflation">(
    editing
      ? editing.growthSource === "inflation" ? "inflation" : "custom"
      : "inflation"
  );
  const [growthRateDisplay, setGrowthRateDisplay] = useState<string>(
    String(pctFromDecimal(editing?.growthRate, 3))
  );
  const [paymentMonth, setPaymentMonth] = useState<number | null>(editing?.paymentMonth ?? null);
  const currentYear = new Date().getFullYear();
  const isEdit = Boolean(editing);

  const expDefaultRefs = !isEdit ? defaultExpenseRefs(editing?.type ?? defaultType) : null;
  // A new education goal funds a programme, not a period of the plan: its end
  // is the four-year length measured off the start, so it follows the start
  // when the beneficiary — or the advisor — moves it. Every other expense keeps
  // the plan's last year. An EXISTING goal keeps whatever span it was saved
  // with; re-framing the picker must never silently re-length a saved goal.
  const newEducation = !isEdit && (editing?.type ?? defaultType) === "education";
  const [startYearRef, setStartYearRef] = useState<YearRef | null>(
    (editing?.startYearRef as YearRef) ?? expDefaultRefs?.startYearRef ?? null
  );
  const [endYearRef, setEndYearRef] = useState<YearRef | null>(
    (editing?.endYearRef as YearRef) ?? (newEducation ? null : expDefaultRefs?.endYearRef ?? null)
  );
  const [startYear, setStartYear] = useState<number>(
    editing?.startYear ?? (startYearRef && clientInfo?.milestones ? resolveMilestone(startYearRef, clientInfo.milestones, "start") ?? currentYear : currentYear)
  );
  const [endYear, setEndYear] = useState<number>(() => {
    if (editing?.endYear != null) return editing.endYear;
    if (newEducation) return startYear + EDUCATION_GOAL_YEARS - 1;
    const resolved =
      endYearRef && clientInfo?.milestones ? resolveMilestone(endYearRef, clientInfo.milestones, "end") : null;
    return resolved ?? currentYear + 20;
  });

  // Only the CURRENT living row may spend the remaining cash flow; the write
  // layer rejects the flag on a retirement row (ABSORB_RETIREMENT_ERROR in
  // expenses-writes.ts) because the solver's retirement living-expense lever
  // has no absorb guard. Derived from live dialog state, not from `editing`, so
  // moving the start year onto retirement hides the checkbox immediately
  // instead of letting the save come back 400.
  const absorbEligible =
    type === "living" &&
    !isRetirementLivingExpense({ type, startYear, endYear, startYearRef }, planStartYear);
  // One definition for "this row is actually absorbing": the checkbox, the
  // amount label and the submitted payload must never disagree. A legacy row
  // that stored the flag while retirement-shaped reads as NOT absorbing, so
  // editing it clears the flag rather than re-submitting an unsaveable value.
  const absorbActive = absorbEligible && absorbsRemaining;

  // Eligible education funding = household accounts (client/spouse) plus any
  // owned by the beneficiary. Recomputed as the "For" person changes.
  const householdMemberIds = (familyMembers ?? [])
    .filter((fm) => fm.role === "client" || fm.role === "spouse")
    .map((fm) => fm.id);
  const allowedFundingOwnerIds = [...householdMemberIds, ...(forFamilyMemberId ? [forFamilyMemberId] : [])];
  // Names for the picker's "· for <beneficiary>" caption on 529 rows.
  const familyMemberNames = Object.fromEntries(
    (familyMembers ?? []).map((fm) => [fm.id, `${fm.firstName}${fm.lastName ? ` ${fm.lastName}` : ""}`]),
  );

  // Switching an unsaved expense to education re-frames its end the same way a
  // dialog opened on education starts out — a four-year programme off the
  // start. Still editable, and never applied to a saved expense.
  function handleTypeChange(next: ExpenseType) {
    setType(next);
    if (!isEdit && next === "education") {
      setEndYear(startYear + EDUCATION_GOAL_YEARS - 1);
      setEndYearRef(null);
    }
  }

  // Picking the beneficiary auto-titles the goal and time-boxes it — see
  // `educationGoalYears`. Both stay editable afterward.
  function handleForChange(fmId: string) {
    setForFamilyMemberId(fmId);
    const fm = (familyMembers ?? []).find((f) => f.id === fmId);
    if (!fm) return;
    setName(`${fm.firstName} - Education`);
    if (fm.dateOfBirth) {
      // Parse the year off the ISO string to dodge the Jan-1 DOB timezone
      // off-by-one that `new Date(...).getFullYear()` produces.
      const birthYear = Number(fm.dateOfBirth.slice(0, 4));
      const span = educationGoalYears(birthYear, currentYear);
      setStartYear(span.startYear);
      setStartYearRef(null);
      setEndYear(span.endYear);
      setEndYearRef(null);
    }
  }

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const data = new FormData(e.currentTarget);
    const body = {
      // Read `type` from controlled state, not FormData: a locked (disabled)
      // default-row select submits no value, and living expenses force the
      // deduction off below regardless of any stale selection.
      type,
      name: data.get("name") as string,
      annualAmount: data.get("annualAmount") as string,
      startYear: String(startYear),
      endYear: String(endYear),
      growthRate: String(Number(growthRateDisplay) / 100),
      growthSource,
      cashAccountId: null,
      ownerAccountId: ownerAccountId ?? null,
      inflationStartYear: todaysDollars ? planStartYear : null,
      startYearRef,
      endYearRef,
      // Living expenses are never a deduction — the Tax Treatment field is hidden
      // for them, so force it null rather than carrying a stale selection.
      deductionType: type === "living" ? null : deductionType || null,
      endsAtMedicareEligibilityOwner,
      payShortfallOutOfPocket: type === "education" ? payOutOfPocket : false,
      institutionState: type === "education" ? (institutionState || null) : null,
      institutionName: type === "education" ? (institutionName || null) : null,
      forFamilyMemberId: type === "education" ? (forFamilyMemberId || null) : null,
      dedicatedAccountIds: type === "education" ? dedicatedAccountIds : [],
      isGoal: type === "education" ? true : isGoal,
      absorbsRemainingCashFlow: absorbActive,
      paymentMonth,
    };

    try {
      const url = isEdit
        ? `/api/clients/${clientId}/expenses/${editing!.id}`
        : `/api/clients/${clientId}/expenses`;
      const newId = !isEdit
        ? typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `tmp-${Date.now()}`
        : editing!.id;
      const res = await writer.submit(
        isEdit
          ? {
              op: "edit",
              targetKind: "expense",
              targetId: editing!.id,
              desiredFields: body,
            }
          : {
              op: "add",
              targetKind: "expense",
              entity: { id: newId, ...body },
            },
        { url, method: isEdit ? "PUT" : "POST", body },
      );

      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? "Failed to save expense");
      }

      const saved: Expense = writer.scenarioActive
        ? ({ id: newId, ...body } as unknown as Expense)
        : ((await res.json()) as Expense);

      // On create: persist the staged schedule. Schedule overrides are out of
      // v1 scenario scope, so this only fires in base mode.
      if (!isEdit && stagedSchedule.length > 0 && !writer.scenarioActive) {
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
      <div className="absolute inset-0 bg-black/70" onClick={() => onOpenChange(false)} />
      <div className="relative z-10 flex max-h-[90vh] w-full max-w-lg flex-col rounded-lg border-2 border-ink-3 ring-1 ring-black/60 bg-gray-900 shadow-xl">
        <div className="flex shrink-0 items-center justify-between px-6 pt-6 pb-4">
          <h2 className="text-lg font-semibold text-gray-100">{isEdit ? "Edit Expense" : "Add Expense"}</h2>
          <button onClick={() => onOpenChange(false)} className="text-gray-300 hover:text-gray-200">
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        <div className="mx-6 flex shrink-0 border-b border-gray-700">
          <button type="button" onClick={() => setActiveTab("details")} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "details" ? "border-accent text-accent" : "border-transparent text-gray-300 hover:text-gray-200"}`}>Details</button>
          <button type="button" onClick={() => setActiveTab("schedule")} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "schedule" ? "border-accent text-accent" : "border-transparent text-gray-300 hover:text-gray-200"}`}>Schedule</button>
        </div>

        {activeTab === "details" && (<>
          <form id="expense-form-fields" onSubmit={handleSubmit} className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
          {error && <p className="rounded bg-red-900/50 px-3 py-2 text-sm text-red-400">{error}</p>}

          <div>
            <label className="block text-sm font-medium text-gray-300" htmlFor="exp-type">Type</label>
            <select
              id="exp-type"
              name="type"
              required
              value={type}
              onChange={(e) => handleTypeChange(e.target.value as ExpenseType)}
              disabled={Boolean(editing?.isDefault)}
              className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              <option value="living">Living Expense</option>
              <option value="insurance">Insurance</option>
              <option value="education">Education</option>
              <option value="other">Other</option>
            </select>
            {editing?.isDefault && (
              <p className="mt-1 text-xs text-gray-400">
                This is a default living expense — it’s always part of the plan and its type can’t be changed.
              </p>
            )}
          </div>

          <label className="flex items-center gap-2 text-sm text-ink-2">
            <input
              type="checkbox"
              checked={type === "education" ? true : isGoal}
              disabled={type === "education"}
              onChange={(e) => setIsGoal(e.target.checked)}
              className="accent-[color:var(--color-accent)]"
            />
            Show as a goal
            {type === "education" && (
              <span className="text-xs text-ink-4">— education expenses always are</span>
            )}
          </label>

          {type === "education" && (
            <div className="space-y-3 rounded-md border border-gray-700 bg-gray-900/40 p-3">
              <div>
                <label className="block text-sm font-medium text-gray-300" htmlFor="exp-for">For</label>
                <select
                  id="exp-for"
                  value={forFamilyMemberId}
                  onChange={(e) => handleForChange(e.target.value)}
                  className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                >
                  <option value="">— Select —</option>
                  {(familyMembers ?? []).map((fm) => (
                    <option key={fm.id} value={fm.id}>
                      {fm.firstName}{fm.lastName ? ` ${fm.lastName}` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-300" htmlFor="exp-inst-state">Institution State</label>
                  <StateSelect
                    id="exp-inst-state"
                    name="institutionState"
                    value={institutionState}
                    onChange={setInstitutionState}
                    className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300" htmlFor="exp-inst-name">Institution Name</label>
                  <input
                    id="exp-inst-name"
                    type="text"
                    value={institutionName}
                    onChange={(e) => setInstitutionName(e.target.value)}
                    className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
              </div>
              <DedicatedFundingPicker
                accounts={accounts}
                value={dedicatedAccountIds}
                onChange={setDedicatedAccountIds}
                allowedOwnerFamilyMemberIds={allowedFundingOwnerIds}
                familyMemberNames={familyMemberNames}
              />
              <label className="flex items-center gap-2 text-sm text-gray-100">
                <input
                  type="checkbox"
                  checked={payOutOfPocket}
                  onChange={(e) => setPayOutOfPocket(e.target.checked)}
                />
                Pay shortfall out of pocket
              </label>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-300" htmlFor="exp-name">
              Name <span className="text-red-500">*</span>
            </label>
            <input
              id="exp-name"
              name="name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Housing"
              className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>

          {absorbEligible && (
            <label className="flex items-center gap-2 text-sm text-ink-2">
              <input
                type="checkbox"
                checked={absorbsRemaining}
                onChange={(e) => setAbsorbsRemaining(e.target.checked)}
                className="accent-[color:var(--color-accent)]"
              />
              Spend whatever&rsquo;s left each year
              <FieldTooltip text="The plan spends this household's entire remaining cash flow — after tax, debt payments, other expenses and savings — on living costs. Set a minimum below only if they have a spending floor they'll never go under; leave it at $0 if they don't." />
            </label>
          )}

          <div className="grid grid-cols-2 gap-4">
            {hasSchedule ? (
              <>
                <input type="hidden" name="annualAmount" value={String(editing?.annualAmount ?? 0)} />
                <div className="col-span-2 flex items-center justify-between rounded-md border border-accent/40 bg-accent/10 px-3 py-2.5">
                  <div>
                    <p className="text-sm font-medium text-accent">Using custom schedule</p>
                    <p className="text-xs text-gray-400">Annual amount and growth rate are overridden by the schedule.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab("schedule")}
                    className="text-xs font-medium text-accent underline hover:text-accent-deep"
                  >
                    View schedule
                  </button>
                </div>
              </>
            ) : (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-300" htmlFor="exp-amount">
                    {absorbActive ? (
                      "Minimum annual spend ($)"
                    ) : (
                      <>Annual Amount ($) <span className="text-red-500">*</span></>
                    )}
                  </label>
                  <CurrencyInput
                    id="exp-amount"
                    name="annualAmount"
                    required
                    defaultValue={editing?.annualAmount ?? 0}
                    className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 py-2 pr-3 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
                <div className={type === "education" ? undefined : "col-span-2"}>
                  <label className="block text-sm font-medium text-gray-300">Growth Rate</label>
                  <div className="mt-1">
                    <GrowthSourceRadio
                      value={growthSource}
                      customRate={growthRateDisplay}
                      resolvedInflationRate={resolvedInflationRate}
                      onChange={(next) => { setGrowthSource(next.value); setGrowthRateDisplay(next.customRate); }}
                    />
                  </div>
                  <label className="mt-2 flex items-center gap-1.5 text-xs text-gray-300">
                    <input
                      type="checkbox"
                      checked={todaysDollars}
                      onChange={(e) => setTodaysDollars(e.target.checked)}
                      className="h-3 w-3 rounded border-gray-600 bg-gray-800 text-accent focus:ring-accent"
                    />
                    Amount in today&apos;s dollars (inflate from {planStartYear})
                  </label>
                </div>
              </>
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
                  clientFirstName={ownerNames.clientName.split(" ")[0]}
                  spouseFirstName={ownerNames.spouseName?.split(" ")[0]}
                  position="start"
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
                  clientFirstName={ownerNames.clientName.split(" ")[0]}
                  spouseFirstName={ownerNames.spouseName?.split(" ")[0]}
                  startYearForDuration={startYear}
                  preferDuration={type === "education"}
                  position="end"
                />
              </>
            ) : (
              <>
                <div>
                  <label className="block text-xs font-medium text-gray-300" htmlFor="exp-start">
                    Start Year
                  </label>
                  <input
                    id="exp-start"
                    name="startYear"
                    type="number"
                    required
                    value={startYear}
                    onChange={(e) => { setStartYear(Number(e.target.value)); setStartYearRef(null); }}
                    className="mt-1 block w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-300" htmlFor="exp-end">
                    End Year
                  </label>
                  <input
                    id="exp-end"
                    name="endYear"
                    type="number"
                    required
                    value={endYear}
                    onChange={(e) => { setEndYear(Number(e.target.value)); setEndYearRef(null); }}
                    className="mt-1 block w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
              </>
            )}
          </div>

          {/* Full width, outside the Start/End Year grid — see the income
              dialog's copy of this control. */}
          <PaymentMonthSelect id="exp-payment-month" value={paymentMonth} onChange={setPaymentMonth} />

          {/* Living expenses are pure cash outflows — never a tax deduction —
              so the Tax Treatment selector only applies to insurance/other. */}
          {type !== "living" && (
            <div>
              <label className="block text-sm font-medium text-gray-300" htmlFor="exp-deductionType">Tax Treatment</label>
              <select
                id="exp-deductionType"
                value={deductionType}
                onChange={(e) => setDeductionType(e.target.value)}
                className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <option value="">None (not a deduction)</option>
                <option value="charitable">Charitable Gift</option>
                <option value="above_line">Above Line Deduction</option>
                <option value="below_line">Below Line Deduction</option>
                <option value="property_tax">Property Tax</option>
              </select>
            </div>
          )}

          <div className="flex flex-col gap-2 border-t border-gray-700 pt-3">
            <label className="flex items-center gap-2 text-sm text-gray-200">
              <input
                type="checkbox"
                checked={endsAtMedicareEligibilityOwner !== null}
                onChange={e =>
                  setEndsAtMedicareEligibilityOwner(e.target.checked ? "client" : null)
                }
              />
              <span>This expense ends at Medicare eligibility</span>
            </label>
            {endsAtMedicareEligibilityOwner !== null && (
              <select
                value={endsAtMedicareEligibilityOwner}
                onChange={e =>
                  setEndsAtMedicareEligibilityOwner(e.target.value as "client" | "spouse")
                }
                className="ml-6 rounded-md border border-gray-600 bg-gray-800 px-2 py-1 text-sm text-gray-100 w-48"
              >
                <option value="client">Client</option>
                {hasSpouse && <option value="spouse">Spouse</option>}
              </select>
            )}
          </div>

          <BusinessOwnerSelect
            id="exp-owner-account"
            accounts={accounts}
            value={ownerAccountId}
            onChange={setOwnerAccountId}
          />

          </form>
          <div className="flex shrink-0 items-center justify-between border-t border-gray-800 bg-gray-900 px-6 py-4">
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
              form="expense-form-fields"
              disabled={loading}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-on hover:bg-accent-ink disabled:opacity-50"
            >
              {loading ? "Saving…" : isEdit ? "Save Changes" : "Add Expense"}
            </button>
          </div>
        </>)}

        {activeTab === "schedule" && (
          <div className="flex-1 overflow-y-auto px-6 py-4">
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
          </div>
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
  familyMembers,
  clientInfo,
  ownerNames,
  incomeSchedules,
  expenseSchedules,
  savingsSchedules,
  flowScenarioFields,
  resolvedInflationRate,
  ssClientInfo,
  ssPlanSettings,
  onOpenEntity,
  embed = "page",
  section = "cash-flow",
}: IncomeExpensesViewProps) {
  const isWizard = embed === "wizard";
  const goalsOnly = section === "goals";
  const { permission } = useClientAccess();
  const canEdit = permission === "edit";
  const writer = useScenarioWriter(clientId);
  const [incomeList, setIncomeList] = useState<Income[]>(initialIncomes);
  const [expenseList, setExpenseList] = useState<Expense[]>(initialExpenses);
  const [savingsRuleList, setSavingsRuleList] = useState<SavingsRule[]>(initialSavingsRules);

  // Edit mode per section
  const [incomeEdit, setIncomeEdit] = useState(false);
  const [expenseEdit, setExpenseEdit] = useState(false);

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
    defaultIsGoal?: boolean;
  }>({ open: false });
  const [savingsDialog, setSavingsDialog] = useState<{ open: boolean; editing?: SavingsRule }>({ open: false });

  // Delete confirms
  const [deletingIncome, setDeletingIncome] = useState<Income | null>(null);
  const [deletingExpense, setDeletingExpense] = useState<Expense | null>(null);
  const [deletingSavings, setDeletingSavings] = useState<SavingsRule | null>(null);

  const accountMap = Object.fromEntries(accounts.map((a) => [a.id, a]));
  const entityMap = Object.fromEntries((entities ?? []).map((e) => [e.id, e]));
  // Business-asset lookup for "Linked to Businesses" rollup — keyed by account id.
  const businessAccountMap = Object.fromEntries(
    accounts.filter((a) => a.category === "business").map((a) => [a.id, a]),
  );

  async function refreshIncomes() {
    try {
      const res = await fetch(`/api/clients/${clientId}/incomes`);
      if (res.ok) {
        const rows = (await res.json()) as Income[];
        setIncomeList(rows);
      }
    } catch {
      // ignore — stale data is preferable to crashing
    }
  }

  // ── Inline field writers ──────────────────────────────────────────────────
  //
  // One per entity, sharing the base/scenario asymmetry `flow-write.ts` owns:
  //
  //   Base mode     → the PATCH ALONE. `incomes-writes.ts` / `expenses-writes.ts`
  //                   apply strict partial updates (`...(p.x !== undefined && {x})`).
  //                   The full-row body this replaced sent
  //                   `endsAtMedicareEligibilityOwner: expense.… ?? null`, and
  //                   `expenseEngineToView` never populates that field, so every
  //                   inline edit wrote a literal null over the Medicare
  //                   auto-end flag. Unreachable while only `living` rows edited
  //                   inline; reachable now that every group does.
  //
  //   Scenario mode → the whole pruned effective row with the patch on top,
  //                   because `applyEntityEdit` stores the payload as a
  //                   wholesale replace and a narrow write deletes the row's
  //                   other overrides in that scenario.
  //
  // Both optimistically update the list with the WHOLE patch and restore the
  // whole pre-edit row on failure. `usePendingEdits` deliberately isn't used:
  // this view already keeps its own list state (see the hook's own header).

  /**
   * Nothing in this task writes `owner`: `Expense` has no owner column, and the
   * income `owner` enum (`client | spouse | joint`) is parked pending a design
   * decision — `InlineOwnerCell` would offer picks it cannot represent. Narrowing
   * the patch type here rather than casting keeps the optimistic spread honest.
   */
  type FlowFieldPatch = Omit<FlowPatch, "owner">;

  /**
   * The scenario field set for a row, or null when the row and the server-built
   * map have drifted. With no field set the scenario payload could only be the
   * narrow write that deletes the row's other overrides, and sending nothing
   * beats sending that — so callers refuse rather than guess.
   */
  function scenarioFieldsFor(id: string): Record<string, unknown> | null {
    return flowScenarioFields[id] ?? null;
  }

  async function saveIncomeField(income: Income, patch: FlowFieldPatch): Promise<boolean> {
    const fields = scenarioFieldsFor(income.id);
    if (!fields) return false;
    const prev = income;
    setIncomeList((list) => list.map((i) => (i.id === income.id ? { ...i, ...patch } : i)));
    try {
      const res = await writer.submit(
        {
          op: "edit",
          targetKind: "income",
          targetId: income.id,
          desiredFields: buildFlowScenarioDesiredFields(fields, patch),
        },
        { url: `/api/clients/${clientId}/incomes/${income.id}`, method: "PUT", body: patch },
      );
      if (!res.ok) throw new Error("Failed to save income");
      return true;
    } catch {
      // The whole pre-edit row back, not one field: a multi-key patch (the year
      // pair, or rate + source) must not half-revert.
      setIncomeList((list) => list.map((i) => (i.id === income.id ? prev : i)));
      return false;
    }
  }

  async function saveExpenseField(expense: Expense, patch: FlowFieldPatch): Promise<boolean> {
    const fields = scenarioFieldsFor(expense.id);
    if (!fields) return false;
    const prev = expense;
    setExpenseList((list) => list.map((e) => (e.id === expense.id ? { ...e, ...patch } : e)));
    try {
      const res = await writer.submit(
        {
          op: "edit",
          targetKind: "expense",
          targetId: expense.id,
          desiredFields: buildFlowScenarioDesiredFields(fields, patch),
        },
        { url: `/api/clients/${clientId}/expenses/${expense.id}`, method: "PUT", body: patch },
      );
      if (!res.ok) throw new Error("Failed to save expense");
      return true;
    } catch {
      setExpenseList((list) => list.map((e) => (e.id === expense.id ? prev : e)));
      return false;
    }
  }

  const milestones = clientInfo?.milestones;

  // Exclude SS rows from the visible income list (SS is shown in its own card)
  const nonSsIncomeList = incomeList.filter((i) => i.type !== "social_security");

  // Totals (household only = exclude out-of-estate). KPIs reflect what's
  // active *this* calendar year — anything starting in the future or already
  // ended is excluded so the headline totals don't overstate today's reality.
  const kpiYear = new Date().getFullYear();
  const isActiveThisYear = (row: { startYear: number; endYear: number }) =>
    row.startYear <= kpiYear && row.endYear >= kpiYear;
  // Mirror the engine's household-totals filter: business-owned rows
  // (ownerAccountId) reach household cash only via the business's
  // distribution sweep, so including the raw amounts here double-counts
  // against KPIs the engine reports — see src/engine/projection.ts:758-788.
  const householdIncome = incomeList
    .filter((i) => !i.ownerEntityId && !i.ownerAccountId && isActiveThisYear(i))
    .reduce((s, i) => s + Number(i.annualAmount), 0);
  const householdExpense = expenseList
    .filter((e) => !e.ownerEntityId && !e.ownerAccountId && isActiveThisYear(e))
    .reduce((s, e) => s + Number(e.annualAmount), 0);
  const netCashFlow = householdIncome - householdExpense;

  const outOfEstateIncome = incomeList
    .filter((i) => i.ownerEntityId && isActiveThisYear(i))
    .reduce((s, i) => s + Number(i.annualAmount), 0);
  const outOfEstateExpense = expenseList
    .filter((e) => e.ownerEntityId && isActiveThisYear(e))
    .reduce((s, e) => s + Number(e.annualAmount), 0);

  // Scenario-aware delete: routes through `useScenarioWriter` so a delete in
  // scenario mode records a `remove` change instead of dropping the base row.
  async function performScenarioDelete(
    targetKind: "income" | "expense" | "savings_rule",
    targetId: string,
    url: string,
  ) {
    const res = await writer.submit(
      { op: "remove", targetKind, targetId },
      { url, method: "DELETE" },
    );
    if (!res.ok && res.status !== 204) {
      const json = await res.json().catch(() => ({}));
      alert(json.error ?? "Failed to delete");
      return false;
    }
    return true;
  }

  /**
   * One expense row, inline cells and all. Shared by the Expenses panel and the
   * Goals panel so the two can never drift on which cells are editable or on
   * how a row opens its full editor.
   *
   * `inlineAmount` — living-expense rows edit their amount in place. Every
   * other group routes through the dialog, whose Schedule tab is the only place
   * a year-by-year amount can be expressed.
   */
  function expenseRow(expense: Expense, { inlineAmount }: { inlineAmount: boolean }) {
    const entityName = expense.ownerEntityId ? entityMap[expense.ownerEntityId]?.name : undefined;
    const businessName = expense.ownerAccountId
      ? businessAccountMap[expense.ownerAccountId]?.name
      : undefined;
    const startRef = coerceYearRef(expense.startYearRef) ?? null;
    const endRef = coerceYearRef(expense.endYearRef) ?? null;
    // An absorbing row has no single annual figure to show or edit inline — the
    // typed amount is only a floor, so the cell states the mode and the floor is
    // edited in the dialog where its label explains what it is. `Row` ignores
    // `value` whenever `amount` AND `onSaveAmount` are both set, so both drop.
    const absorbing = Boolean(expense.absorbsRemainingCashFlow);
    // The value column is sized for a currency figure. "Whatever’s left" alone
    // already crowds it, so the floor rides on the meta line under the name —
    // appending it to the value squeezed the name column out of the row
    // entirely and still clipped at the card edge.
    const valueText = absorbing ? "Whatever’s left" : fmt(expense.annualAmount);
    const floorMeta =
      absorbing && Number(expense.annualAmount) > 0
        ? `min ${fmt(expense.annualAmount)}`
        : null;
    return (
      <Row
        key={expense.id}
        onEdit={canEdit ? () => setExpenseDialog({ open: true, editing: expense }) : undefined}
        amount={inlineAmount && !absorbing ? Number(expense.annualAmount) : undefined}
        onSaveAmount={
          canEdit && inlineAmount && !absorbing
            ? (next) => saveExpenseField(expense, flowAmountPatch(next))
            : undefined
        }
        startSlot={
          milestones ? (
            <InlineYearCell
              year={expense.startYear}
              yearRef={startRef}
              milestones={milestones}
              position="start"
              showSSRefs={isSsRef(startRef)}
              label={`start year for ${expense.name}`}
              canEdit={canEdit}
              onSave={(year, ref) => saveExpenseField(expense, flowYearPatch("start", year, ref))}
            />
          ) : (
            <PlainYearCell year={expense.startYear} />
          )
        }
        endSlot={
          milestones ? (
            <InlineYearCell
              year={expense.endYear}
              yearRef={endRef}
              milestones={milestones}
              position="end"
              showSSRefs={isSsRef(endRef)}
              label={`end year for ${expense.name}`}
              canEdit={canEdit}
              onSave={(year, ref) => saveExpenseField(expense, flowYearPatch("end", year, ref))}
            />
          ) : (
            <PlainYearCell year={expense.endYear} />
          )
        }
        rateSlot={
          <FlowGrowthCell
            row={expense}
            resolvedInflationRate={resolvedInflationRate}
            canEdit={canEdit}
            onSave={(patch) => saveExpenseField(expense, patch)}
          />
        }
        editMode={canEdit && expenseEdit}
        onDelete={canEdit && !expense.isDefault ? () => setDeletingExpense(expense) : undefined}
        label={expense.name}
        meta={[entityName ?? businessName ?? null, floorMeta]}
        value={valueText}
        outOfEstate={Boolean(expense.ownerEntityId)}
      />
    );
  }

  // The expense editor and its delete confirm are rendered by BOTH layouts
  // below, so they're built once here instead of duplicated per branch.
  const expenseDialogNode = expenseDialog.open ? (
    <ExpenseDialog
      key={expenseDialog.editing?.id ?? "new"}
      clientId={clientId}
      accounts={accounts}
      entities={entities}
      familyMembers={familyMembers}
      clientInfo={clientInfo}
      ownerNames={ownerNames}
      open={expenseDialog.open}
      onOpenChange={(o) => setExpenseDialog((d) => ({ ...d, open: o, editing: o ? d.editing : undefined }))}
      defaultType={expenseDialog.defaultType}
      defaultIsGoal={expenseDialog.defaultIsGoal}
      editing={expenseDialog.editing}
      onSaved={(expense, mode) => {
        if (mode === "create") setExpenseList((prev) => [...prev, expense]);
        else setExpenseList((prev) => prev.map((e) => (e.id === expense.id ? expense : e)));
      }}
      onRequestDelete={
        expenseDialog.editing && !expenseDialog.editing.isDefault
          ? () => {
              if (expenseDialog.editing) setDeletingExpense(expenseDialog.editing);
            }
          : undefined
      }
      schedule={expenseDialog.editing ? expenseSchedules[expenseDialog.editing.id] : undefined}
      resolvedInflationRate={resolvedInflationRate}
    />
  ) : null;

  const expenseDeleteConfirmNode = (
    <ConfirmDeleteDialog
      open={!!deletingExpense}
      title="Delete Expense"
      message={deletingExpense ? `Delete "${deletingExpense.name}"?` : ""}
      onCancel={() => setDeletingExpense(null)}
      onConfirm={async () => {
        if (!deletingExpense) return;
        const ok = await performScenarioDelete(
          "expense",
          deletingExpense.id,
          `/api/clients/${clientId}/expenses/${deletingExpense.id}`,
        );
        if (ok) {
          setExpenseList((prev) => prev.filter((e) => e.id !== deletingExpense.id));
          setExpenseDialog({ open: false });
          setDeletingExpense(null);
        }
      }}
    />
  );

  // ── Render ────────────────────────────────────────────────────────────────

  if (goalsOnly) {
    // Goals have no table of their own: they are expenses that either are
    // education (always a goal) or carry the advisor's `isGoal` flag — the same
    // set the Household Map's Goals board draws. The groups split by TYPE
    // rather than by flag, so "Other Goals" catches a flagged living or
    // insurance row too instead of silently dropping it.
    const goalExpenses = expenseList.filter(isGoalExpense);
    const goalGroups: { label: string; defaultType: ExpenseType; items: Expense[]; empty: string }[] = [
      {
        label: "Education",
        defaultType: "education",
        items: goalExpenses.filter((e) => e.type === "education"),
        empty: "No education goals yet.",
      },
      {
        label: "Other Goals",
        defaultType: "other",
        items: goalExpenses.filter((e) => e.type !== "education"),
        empty: "No other goals yet — a home purchase, a wedding, a sabbatical.",
      },
    ];

    return (
      <div className="space-y-6">
        <Panel>
          <SectionHeader
            title="Goals"
            subtitle={`${goalExpenses.length} goal${goalExpenses.length === 1 ? "" : "s"}`}
            actions={
              canEdit ? (
                <>
                  {goalExpenses.length > 0 && (
                    <EditToggle on={expenseEdit} onToggle={() => setExpenseEdit((v) => !v)} />
                  )}
                  <button
                    onClick={() => setExpenseDialog({ open: true, defaultType: "education", defaultIsGoal: true })}
                    className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-on hover:bg-accent-ink"
                  >
                    + Add
                  </button>
                </>
              ) : undefined
            }
          />
          {goalGroups.map((group) => (
            <Group
              key={group.label}
              label={group.label}
              total={fmt(group.items.reduce((s, e) => s + Number(e.annualAmount), 0))}
              onAdd={
                canEdit
                  ? () =>
                      setExpenseDialog({ open: true, defaultType: group.defaultType, defaultIsGoal: true })
                  : undefined
              }
            >
              {group.items.length === 0 ? (
                <EmptyRow message={group.empty} />
              ) : (
                group.items.map((expense) => expenseRow(expense, { inlineAmount: false }))
              )}
            </Group>
          ))}
        </Panel>

        {expenseDialogNode}
        {expenseDeleteConfirmNode}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* KPI strip — hidden in wizard mode; the wizard shell shows its own progress */}
      {!isWizard && (
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
      )}

      {/* Income + Expenses two-column */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Income */}
        <Panel>
          <SectionHeader
            title="Income"
            subtitle={fmt(householdIncome) + " household · " + nonSsIncomeList.length + " entries"}
            actions={
              canEdit ? (
                <>
                  {nonSsIncomeList.length > 0 && <EditToggle on={incomeEdit} onToggle={() => setIncomeEdit((v) => !v)} />}
                  <button
                    onClick={() => setIncomeDialog({ open: true, defaultType: "salary" })}
                    className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-on hover:bg-accent-ink"
                  >
                    + Add
                  </button>
                </>
              ) : undefined
            }
          />

          {nonSsIncomeList.length === 0 ? (
            <EmptyRow message="No income entries yet." />
          ) : (
            <>
              {INCOME_GROUPS.map((group) => {
                // Exclude entity- and business-account-owned rows; they render
                // in their own rollups ("Linked Entities" / "Linked to
                // Businesses") below and would otherwise duplicate here and
                // double-count the per-group subtotal.
                const items = incomeList.filter(
                  (i) =>
                    group.types.includes(i.type) && !i.ownerEntityId && !i.ownerAccountId,
                );
                if (items.length === 0) return null;
                const subtotal = items.reduce((s, i) => s + Number(i.annualAmount), 0);
                return (
                  <Group
                    key={group.label}
                    label={group.label}
                    total={fmt(subtotal)}
                    onAdd={canEdit ? () => setIncomeDialog({ open: true, defaultType: group.types[0] }) : undefined}
                  >
                    {items.map((income) => {
                      const entityName = income.ownerEntityId
                        ? entityMap[income.ownerEntityId]?.name
                        : undefined;
                      const businessName = income.ownerAccountId
                        ? businessAccountMap[income.ownerAccountId]?.name
                        : undefined;
                      const startRef = coerceYearRef(income.startYearRef) ?? null;
                      const endRef = coerceYearRef(income.endYearRef) ?? null;
                      return (
                        <Row
                          key={income.id}
                          // No row-level onClick: it swallows clicks meant for
                          // the cells inside it. The pencil is the only route to
                          // the full editor now — and income needs one, because
                          // name, type, tax treatment, claiming age and schedule
                          // live nowhere else.
                          onEdit={canEdit ? () => setIncomeDialog({ open: true, editing: income }) : undefined}
                          editMode={canEdit && incomeEdit}
                          onDelete={canEdit ? () => setDeletingIncome(income) : undefined}
                          label={income.name}
                          meta={[
                            entityName ??
                              businessName ??
                              individualOwnerLabel(income.owner, ownerNames),
                            income.claimingAge ? `Claim @ ${income.claimingAge}` : null,
                          ]}
                          startSlot={
                            milestones ? (
                              <InlineYearCell
                                year={income.startYear}
                                yearRef={startRef}
                                milestones={milestones}
                                position="start"
                                showSSRefs={isSsRef(startRef)}
                                label={`start year for ${income.name}`}
                                canEdit={canEdit}
                                onSave={(year, ref) =>
                                  saveIncomeField(income, flowYearPatch("start", year, ref))
                                }
                              />
                            ) : (
                              <PlainYearCell year={income.startYear} />
                            )
                          }
                          endSlot={
                            milestones ? (
                              <InlineYearCell
                                year={income.endYear}
                                yearRef={endRef}
                                milestones={milestones}
                                position="end"
                                showSSRefs={isSsRef(endRef)}
                                label={`end year for ${income.name}`}
                                canEdit={canEdit}
                                onSave={(year, ref) =>
                                  saveIncomeField(income, flowYearPatch("end", year, ref))
                                }
                              />
                            ) : (
                              <PlainYearCell year={income.endYear} />
                            )
                          }
                          rateSlot={
                            <FlowGrowthCell
                              row={income}
                              resolvedInflationRate={resolvedInflationRate}
                              canEdit={canEdit}
                              onSave={(patch) => saveIncomeField(income, patch)}
                            />
                          }
                          value={fmt(income.annualAmount)}
                          outOfEstate={Boolean(income.ownerEntityId)}
                        />
                      );
                    })}
                  </Group>
                );
              })}

              {(() => {
                // "Linked Entities" — read-only rollup of incomes/expenses that
                // are owned by a trust or business. Filter to ids present in
                // entityMap so orphaned data doesn't render a placeholder row.
                const linkedIncomes = incomeList.filter(
                  (i) => i.ownerEntityId && entityMap[i.ownerEntityId],
                );
                const linkedExpenses = expenseList.filter(
                  (e) => e.ownerEntityId && entityMap[e.ownerEntityId],
                );
                if (linkedIncomes.length === 0 && linkedExpenses.length === 0) return null;
                const byEntity = new Map<
                  string,
                  { incomes: typeof linkedIncomes; expenses: typeof linkedExpenses; name: string }
                >();
                for (const i of linkedIncomes) {
                  const id = i.ownerEntityId!;
                  const bucket =
                    byEntity.get(id) ?? { incomes: [], expenses: [], name: entityMap[id].name };
                  bucket.incomes.push(i);
                  byEntity.set(id, bucket);
                }
                for (const e of linkedExpenses) {
                  const id = e.ownerEntityId!;
                  const bucket =
                    byEntity.get(id) ?? { incomes: [], expenses: [], name: entityMap[id].name };
                  bucket.expenses.push(e);
                  byEntity.set(id, bucket);
                }
                return (
                  <Group label="Linked Entities" total="">
                    {[...byEntity.entries()].map(([entId, b]) => {
                      const incomeTotal = b.incomes.reduce(
                        (s, i) => s + Number(i.annualAmount),
                        0,
                      );
                      const expenseTotal = b.expenses.reduce(
                        (s, e) => s + Number(e.annualAmount),
                        0,
                      );
                      return (
                        <Row
                          key={entId}
                          onClick={onOpenEntity ? () => onOpenEntity(entId, "flows") : undefined}
                          editMode={false}
                          label={b.name}
                          meta={[
                            b.incomes.length > 0
                              ? `${b.incomes.length} income${b.incomes.length === 1 ? "" : "s"}`
                              : null,
                            b.expenses.length > 0
                              ? `${b.expenses.length} expense${b.expenses.length === 1 ? "" : "s"}`
                              : null,
                          ]}
                          value={fmt(incomeTotal - expenseTotal)}
                          outOfEstate
                        />
                      );
                    })}
                  </Group>
                );
              })()}

              {(() => {
                // "Linked to Businesses" — read-only rollup of incomes/expenses
                // pointed at a business account (Phase 2). Mirrors the Linked
                // Entities section above. Filter to ids present in
                // businessAccountMap so orphaned data doesn't render.
                const linkedIncomes = incomeList.filter(
                  (i) => i.ownerAccountId && businessAccountMap[i.ownerAccountId],
                );
                const linkedExpenses = expenseList.filter(
                  (e) => e.ownerAccountId && businessAccountMap[e.ownerAccountId],
                );
                if (linkedIncomes.length === 0 && linkedExpenses.length === 0) return null;
                const byAccount = new Map<
                  string,
                  { incomes: typeof linkedIncomes; expenses: typeof linkedExpenses; name: string }
                >();
                for (const i of linkedIncomes) {
                  const id = i.ownerAccountId!;
                  const bucket =
                    byAccount.get(id) ?? { incomes: [], expenses: [], name: businessAccountMap[id].name };
                  bucket.incomes.push(i);
                  byAccount.set(id, bucket);
                }
                for (const e of linkedExpenses) {
                  const id = e.ownerAccountId!;
                  const bucket =
                    byAccount.get(id) ?? { incomes: [], expenses: [], name: businessAccountMap[id].name };
                  bucket.expenses.push(e);
                  byAccount.set(id, bucket);
                }
                return (
                  <Group label="Linked to Businesses" total="">
                    {[...byAccount.entries()].map(([accId, b]) => {
                      const incomeTotal = b.incomes.reduce(
                        (s, i) => s + Number(i.annualAmount),
                        0,
                      );
                      const expenseTotal = b.expenses.reduce(
                        (s, e) => s + Number(e.annualAmount),
                        0,
                      );
                      return (
                        <Row
                          key={accId}
                          editMode={false}
                          label={b.name}
                          meta={[
                            b.incomes.length > 0
                              ? `${b.incomes.length} income${b.incomes.length === 1 ? "" : "s"}`
                              : null,
                            b.expenses.length > 0
                              ? `${b.expenses.length} expense${b.expenses.length === 1 ? "" : "s"}`
                              : null,
                          ]}
                          value={fmt(incomeTotal - expenseTotal)}
                        />
                      );
                    })}
                  </Group>
                );
              })()}
            </>
          )}

          {ssClientInfo && ssPlanSettings && (
            <div className="px-4 pb-4">
              <SocialSecurityCard
                clientId={clientId}
                clientInfo={ssClientInfo}
                planSettings={ssPlanSettings}
                incomes={incomeList as unknown as EngineIncome[]}
                onSaved={refreshIncomes}
                canEdit={canEdit}
              />
            </div>
          )}
        </Panel>

        {/* Expenses */}
        <Panel>
          <SectionHeader
            title="Expenses"
            subtitle={fmt(householdExpense) + " household · " + expenseList.length + " entries"}
            actions={
              canEdit ? (
                <>
                  {expenseList.length > 0 && <EditToggle on={expenseEdit} onToggle={() => setExpenseEdit((v) => !v)} />}
                  <button
                    onClick={() => setExpenseDialog({ open: true, defaultType: "living" })}
                    className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-on hover:bg-accent-ink"
                  >
                    + Add
                  </button>
                </>
              ) : undefined
            }
          />

          {expenseList.length === 0 ? (
            <EmptyRow message="No expense entries yet." />
          ) : (
            EXPENSE_GROUPS.map((group) => {
              // Exclude entity- and business-account-owned rows; they render
              // in their own rollups ("Linked Entities" / "Linked to
              // Businesses") below and would otherwise duplicate here and
              // double-count the per-group subtotal.
              const items = expenseList.filter(
                (e) =>
                  group.types.includes(e.type) && !e.ownerEntityId && !e.ownerAccountId,
              );
              if (items.length === 0) return null;
              // Living-expense rows edit their amount inline. The row-level
              // click-to-open is gone for EVERY group now — the inline year and
              // rate cells make it unusable — so every group gets the pencil.
              const isLiving = group.types.includes("living");
              // The two seeded slots are the plan's spine — every other living
              // row is detail hung off them — so they lead the group in plan
              // order. Safe in place: `filter` above already returned a fresh
              // array, so this never reorders `expenseList` itself.
              if (isLiving) items.sort((a, b) => livingSlotRank(a) - livingSlotRank(b));
              const subtotal = items.reduce((s, e) => s + Number(e.annualAmount), 0);
              return (
                <Group
                  key={group.label}
                  label={group.label}
                  total={fmt(subtotal)}
                  onAdd={canEdit ? () => setExpenseDialog({ open: true, defaultType: group.types[0] }) : undefined}
                >
                  {items.map((expense) => expenseRow(expense, { inlineAmount: isLiving }))}
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
        />
        <div className="px-4 py-3">
          <SavingsRulesList
            rules={savingsRuleList}
            accountsById={accountMap}
            showAccountColumn
            onEdit={canEdit ? (rule) => setSavingsDialog({ open: true, editing: rule }) : undefined}
            onDelete={canEdit ? (rule) => setDeletingSavings(rule) : undefined}
            onAdd={canEdit ? () => setSavingsDialog({ open: true }) : undefined}
            emptyMessage={accounts.length === 0 ? "Add accounts first, then set up contribution rules." : "No savings rules yet."}
          />
        </div>
      </Panel>

      {/* Dialogs */}
      {incomeDialog.open && (
        <IncomeDialog
          key={incomeDialog.editing?.id ?? "new"}
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
          resolvedInflationRate={resolvedInflationRate}
        />
      )}

      {expenseDialogNode}

      {savingsDialog.open && (
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
          clientInfo={clientInfo}
          ownerNames={ownerNames}
          familyMembers={familyMembers}
          resolvedInflationRate={resolvedInflationRate}
          salaries={toSalaryOptions(incomeList, ownerNames)}
        />
      )}

      {/* Delete confirms */}
      <ConfirmDeleteDialog
        open={!!deletingIncome}
        title="Delete Income"
        message={deletingIncome ? `Delete "${deletingIncome.name}"?` : ""}
        onCancel={() => setDeletingIncome(null)}
        onConfirm={async () => {
          if (!deletingIncome) return;
          const ok = await performScenarioDelete(
            "income",
            deletingIncome.id,
            `/api/clients/${clientId}/incomes/${deletingIncome.id}`,
          );
          if (ok) {
            setIncomeList((prev) => prev.filter((i) => i.id !== deletingIncome.id));
            setIncomeDialog({ open: false });
            setDeletingIncome(null);
          }
        }}
      />

      {expenseDeleteConfirmNode}

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
          const ok = await performScenarioDelete(
            "savings_rule",
            deletingSavings.id,
            `/api/clients/${clientId}/savings-rules/${deletingSavings.id}`,
          );
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
      <p className="text-xs font-medium uppercase tracking-wider text-gray-400">{label}</p>
      <p className={`mt-1 text-lg font-bold ${accent}`}>{value}</p>
      {subtitle && <p className="text-xs text-gray-400">{subtitle}</p>}
    </div>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="overflow-hidden rounded-lg border border-gray-800 bg-gray-900/50">{children}</div>;
}

function EmptyRow({ message }: { message: string }) {
  return <div className="px-4 py-8 text-center text-sm text-gray-400">{message}</div>;
}
