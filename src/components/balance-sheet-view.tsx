"use client";

import { useCallback, useRef, useState, useEffect } from "react";
import { createPortal } from "react-dom";
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
import { toSalaryOptions } from "@/lib/savings/salary-options";
import { LIQUID_PORTFOLIO_CATEGORIES } from "@/engine/portfolio-snapshot";
import type { ClientMilestones } from "@/lib/milestones";
import type { AccountOwner } from "@/engine/ownership";
import {
  buildNoteReceivableSchedule,
  type NoteReceivable,
} from "@/engine/notes-receivable";
import { useToast } from "@/components/toast";
import { refreshClientHoldingPrices } from "@/lib/investments/holdings-client";
import { useClientAccess } from "./client-access-provider";
import Row from "@/components/balance-sheet/row";
import CategoryGroup from "@/components/balance-sheet/category-group";
import BusinessRowGroup from "@/components/balance-sheet/business-row-group";
import { ChevronDown, ChevronRight, LinkedSourceBadge } from "@/components/balance-sheet/icons";
import InlineOwnerCell from "@/components/forms/inline-owner-cell";
import { FieldTooltip } from "@/components/forms/field-tooltip";
import GrowthRateCell from "@/components/forms/growth-rate-cell";
import { InlineAmount } from "@/components/forms/inline-amount";
import { usePendingEdits } from "@/hooks/use-pending-edits";
import {
  buildBasePayload,
  buildScenarioDesiredFields,
  type AccountPatch,
} from "@/lib/inline-edit/account-write";
import {
  buildLiabilityBasePayload,
  buildLiabilityScenarioDesiredFields,
  type LiabilityPatch,
} from "@/lib/inline-edit/liability-write";
import type { GrowthContext } from "@/lib/investments/growth-context";
import type { CategoryDefaultRateMap } from "@/lib/investments/category-default-rates";

type AccountCategory = "taxable" | "cash" | "retirement" | "annuity" | "real_estate" | "business" | "life_insurance" | "notes_receivable" | "stock_options" | "education_savings";

/** Which external integration feeds a row's balance. `null`/`undefined` means
 *  the account or liability was entered by hand. Drives the small linked
 *  indicator next to the name. Extend this union (and LINKED_SOURCE_LABEL) as
 *  integrations are added — addepar, black_diamond, … */
export type LinkedSource = "plaid" | "orion";

export interface AccountRow {
  id: string;
  name: string;
  category: AccountCategory;
  subType: string;
  owner: string;
  value: string;
  basis: string;
  /** External integration that feeds this account (plaid/orion). Null/undefined
   *  = manually entered. Set only by the Net Worth loader; report builders leave
   *  it unset. Drives the linked indicator next to the name. */
  linkedSource?: LinkedSource | null;
  rothValue?: string | null;
  /** HSA coverage tier (self/family). Hydrated from `accounts.hsa_coverage`
   * so the edit form round-trips the value instead of silently defaulting to
   * "self" (which would overwrite a persisted "family" on the next save). */
  hsaCoverage?: "self" | "family" | null;
  growthRate: string | null;
  rmdEnabled?: boolean | null;
  /** Advisor-set AUM flag, hydrated from `accounts.counts_toward_aum` via
   *  AccountMeta so the edit form round-trips it instead of silently clearing
   *  it on save. Only meaningful for taxable/cash/retirement. */
  countsTowardAum?: boolean | null;
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
  /** 529 / education_savings only — grantor/beneficiary/Roth-rollover fields.
   *  Null/undefined for every other category. No account_owners rows are
   *  written for this category; these fields are authoritative instead. */
  grantorFamilyMemberId?: string | null;
  grantorName?: string | null;
  beneficiaryFamilyMemberId?: string | null;
  beneficiaryName?: string | null;
  rothRolloverEnabled?: boolean;
  rothRolloverStartYear?: number | null;
  rothRolloverAccountId?: string | null;
  /** Server-resolved display name for the Out-of-Estate 529 grouping —
   *  the family member's first+last name when beneficiaryFamilyMemberId is
   *  set, else beneficiaryName. */
  beneficiaryDisplayName?: string | null;
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
  /** External integration that feeds this liability (plaid). Null/undefined =
   *  manually entered. Drives the linked indicator next to the name. */
  linkedSource?: LinkedSource | null;
  owners?: AccountOwner[];
  /** Parent business account id when this liability hangs off a business
   *  (e.g. an LLC's mortgage). Null for household liabilities. */
  parentAccountId?: string | null;
}

/** An income as the balance sheet renders it. Two consumers: the "Incomes"
 *  pill inside an expanded business row reads the subset whose `ownerAccountId`
 *  points at a business shown here, and the Add/Edit Account dialog turns the
 *  salaries into the choices a percent-of-salary savings rule can be based on.
 *  The optional schedule fields (startYear/endYear/growthRate/
 *  inflationStartYear) drive the Custom-schedule placeholder math in
 *  BusinessFlowsTab. */
export interface IncomeRow {
  id: string;
  /** Income kind. `toSalaryOptions` offers only `"salary"` rows. */
  type: string;
  name: string;
  annualAmount: number | string;
  owner: string;
  /** Set when a trust or business owns the income; those are never a
   *  household deferral's salary base. */
  ownerEntityId?: string | null;
  ownerAccountId?: string | null;
  startYear?: number | null;
  endYear?: number | null;
  growthRate?: number | null;
  inflationStartYear?: number | null;
}

interface BalanceSheetViewProps {
  clientId: string;
  accounts: AccountRow[];
  liabilities: LiabilityRow[];
  notesReceivable?: NoteReceivable[];
  /** Every income in the plan. Built by `buildIncomeRows`. */
  incomes?: IncomeRow[];
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
  /**
   * Growth-rate dropdown context for the inline rate cell on asset rows.
   * Server-built (`net-worth-content.tsx`) and OPTIONAL: the onboarding wizard's
   * accounts/liabilities steps mount this view without it and simply get no
   * rate cell. Deliberately not derived from `modelPortfolios`/`categoryDefaults`
   * — those props carry a narrower shape (no `riskLevel`) and a different unit
   * (flat decimal strings vs `blendedReturnPct`).
   */
  growthContext?: GrowthContext;
  /**
   * Per-category default RATES as decimal strings, all ten categories.
   * NAMING TRAP: this is NOT `growthContext.categoryDefaults`, which is a
   * `{portfolioName, blendedReturnPct}` label map for three categories. The
   * rate cell needs this one. Travels with `growthContext`.
   */
  categoryDefaultRates?: CategoryDefaultRateMap;
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
  education_savings: "529 / Education",
};

const CATEGORY_ORDER: AccountCategory[] = [
  "taxable",
  "cash",
  "retirement",
  "annuity",
  "real_estate",
  "business",
  "stock_options",
  "education_savings",
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
  "education_savings",
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

/** Exported for the Household Map's edit pencil, which opens this same dialog
 *  from `accountRows` (`lib/accounts/load-account-rows.ts` builds the identical
 *  merged row this page uses). Keep it the single hydration path — a second,
 *  parallel adapter is how the two editors start disagreeing. */
export function accountToInitial(a: AccountRow): AccountFormInitial {
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
    countsTowardAum: a.countsTowardAum ?? false,
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
    grantorFamilyMemberId: a.grantorFamilyMemberId ?? null,
    grantorName: a.grantorName ?? null,
    beneficiaryFamilyMemberId: a.beneficiaryFamilyMemberId ?? null,
    beneficiaryName: a.beneficiaryName ?? null,
    rothRolloverEnabled: a.rothRolloverEnabled ?? false,
    rothRolloverStartYear: a.rothRolloverStartYear ?? null,
    rothRolloverAccountId: a.rothRolloverAccountId ?? null,
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
  const schedule = computeAmortizationSchedule(origBal, rate, pmt, l.startYear, l.termMonths, [], l.startMonth);
  const row = schedule.find((r) => r.year === currentYear - 1);
  if (row) return row.endingBalance;
  // If current year is past the loan term, balance is 0
  const lastRow = schedule[schedule.length - 1];
  return lastRow ? lastRow.endingBalance : 0;
}

// ── Dropdown for "Add Asset" category picker ──────────────────────────────────

const ADD_ASSET_MENU_W = 192;

/** Category picker portaled to <body> and fixed-positioned off the trigger's
 *  rect. Rendering it in-flow let any ancestor with `overflow-hidden` clip the
 *  list — the onboarding wizard's step card did exactly that, hiding every
 *  category below "Retirement". Flips above the trigger when the viewport is
 *  short. Closes on outside click, Escape, scroll, or resize. */
function AddAssetMenu({ onPick }: { onPick: (cat: AccountCategory) => void }) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  // `pos` doubles as the open flag — non-null means open, so there is no second
  // piece of state to keep in sync with it.
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);

  const close = useCallback(() => setPos(null), []);

  const openMenu = useCallback(() => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    // Right-align to the trigger, clamped into the viewport.
    const left = Math.min(
      Math.max(8, r.right - ADD_ASSET_MENU_W),
      window.innerWidth - ADD_ASSET_MENU_W - 8,
    );
    // ~36px per row plus padding — enough headroom to decide which way to open.
    const menuH = ADDABLE_CATEGORIES.length * 36 + 8;
    const spaceBelow = window.innerHeight - r.bottom;
    const openUp = spaceBelow < menuH && r.top > spaceBelow;
    setPos(openUp ? { left, bottom: window.innerHeight - r.top + 4 } : { left, top: r.bottom + 4 });
  }, []);

  useEffect(() => {
    if (!pos) return;
    const onMove = () => close();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("keydown", onKey);
    };
  }, [pos, close]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (pos ? close() : openMenu())}
        aria-haspopup="menu"
        aria-expanded={pos !== null}
        className="inline-flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-on hover:bg-accent-ink"
      >
        + Add Asset <ChevronDown />
      </button>
      {pos &&
        createPortal(
          <>
            <button
              type="button"
              aria-label="Close menu"
              onClick={close}
              className="fixed inset-0 z-50 cursor-default"
            />
            <div
              role="menu"
              aria-label="Add asset"
              className="fixed z-50 max-h-[min(70vh,520px)] overflow-y-auto rounded-md border border-hair bg-card py-1 shadow-lg"
              style={{ left: pos.left, top: pos.top, bottom: pos.bottom, width: ADD_ASSET_MENU_W }}
            >
              {ADDABLE_CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    close();
                    onPick(cat);
                  }}
                  className="block w-full px-3 py-2 text-left text-sm text-ink-2 hover:bg-card-hover hover:text-ink"
                >
                  {CATEGORY_LABELS[cat]}
                </button>
              ))}
            </div>
          </>,
          document.body,
        )}
    </>
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
  growthContext,
  categoryDefaultRates,
  embed = "page",
  section,
  planStartYear,
  planEndYear,
  primaryClientBirthYear,
}: BalanceSheetViewProps) {
  const isWizard = embed === "wizard";
  const showAssetsCol = !isWizard || section === "accounts";
  const showLiabilitiesCol = !isWizard || section === "liabilities";
  const { permission } = useClientAccess();
  const canEdit = permission === "edit";
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

  // This view holds no row state — it renders props and re-renders via
  // `router.refresh()`. Without an optimistic overlay every inline edit would
  // sit unchanged until the round-trip lands, which reads as a dead control.
  const pendingAccounts = usePendingEdits(accounts);

  /** Persist one inline asset-row field. The two payloads are deliberately
   *  asymmetric — see `lib/inline-edit/account-write.ts`, which owns both. */
  async function saveAccountField(id: string, patch: AccountPatch): Promise<boolean> {
    // The MERGED row, not the raw `accounts` prop. `buildScenarioDesiredFields`
    // sends the WHOLE row plus the patch, so a second edit landing before the
    // first round-trip completes would carry the STALE field and silently
    // revert it.
    const row = pendingAccounts.rows.find((a) => a.id === id);
    if (!row) return false;
    return pendingAccounts.apply(id, patch, async () => {
      const res = await writer.submit(
        {
          op: "edit",
          targetKind: "account",
          targetId: id,
          desiredFields: buildScenarioDesiredFields(row, patch),
        },
        {
          url: `/api/clients/${clientId}/accounts/${id}`,
          method: "PUT",
          body: buildBasePayload(patch),
        },
      );
      if (!res.ok) showToast({ message: `Couldn't save ${row.name}.` });
      return res.ok;
    });
  }

  const pendingLiabilities = usePendingEdits(liabilities);

  /** Persist one inline liability-row field. Same deliberate base/scenario
   *  asymmetry as the account writer — `lib/inline-edit/liability-write.ts`
   *  owns both payloads. */
  async function saveLiabilityField(id: string, patch: LiabilityPatch): Promise<boolean> {
    // The MERGED row, for the same reason `saveAccountField` reads one:
    // `buildLiabilityScenarioDesiredFields` sends the WHOLE row plus the
    // patch, so a second edit landing before the first round-trip completes
    // would carry the STALE field and silently revert it.
    const row = pendingLiabilities.rows.find((l) => l.id === id);
    if (!row) return false;
    return pendingLiabilities.apply(id, patch, async () => {
      const res = await writer.submit(
        {
          op: "edit",
          targetKind: "liability",
          targetId: id,
          desiredFields: buildLiabilityScenarioDesiredFields(row, patch),
        },
        {
          url: `/api/clients/${clientId}/liabilities/${id}`,
          method: "PUT",
          body: buildLiabilityBasePayload(patch),
        },
      );
      if (!res.ok) showToast({ message: `Couldn't save ${row.name}.` });
      return res.ok;
    });
  }

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
  // owning entity is a family-owned business interest. 529s are always
  // out-of-estate — a completed gift under §529, never household property —
  // so this check runs BEFORE the no-entity-owner fallback below, which would
  // otherwise default an ownerless 529 (they carry no account_owners rows) to
  // in-estate the same way it does for household-owned Plaid imports (see
  // memory: balance-sheet-ownerless-account-drop-fix).
  const accountInEstate = (a: AccountRow): boolean => {
    if (a.category === "education_savings") return false;
    return !a.ownerEntityId || isFamilyOwnedBusiness(a.ownerEntityId);
  };

  // Legacy notes_receivable accounts are sourced from `notesReceivable` now.
  // Reads the MERGED rows so an in-flight inline edit shows immediately — and
  // so the KPI totals derived from these lists move with it.
  const nonNoteAccounts = pendingAccounts.rows.filter((a) => a.category !== "notes_receivable");

  const inEstate = nonNoteAccounts.filter((a) => accountInEstate(a) && isVisibleInNetWorth(a));
  // 529s render as their own category group in the Assets card — that's where
  // advisors add and look for them — but stay excluded from the in-estate
  // totals / Net Worth. The Out of Estate box below is only for trust/entity-
  // held assets, so they're excluded there too.
  const education529s = nonNoteAccounts.filter(
    (a) => a.category === "education_savings" && isVisibleInNetWorth(a),
  );
  const outOfEstate = nonNoteAccounts.filter(
    (a) =>
      !accountInEstate(a) && a.category !== "education_savings" && isVisibleInNetWorth(a),
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
  // Salaries a percent-of-salary savings rule can be based on, for the
  // Add/Edit Account dialog's Savings tab.
  const salaryOptions = toSalaryOptions(incomes, ownerNames);

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
    education_savings: [],
  };
  // Top-level accounts only — children render under their parent's expanded view.
  for (const a of inEstate) {
    if (a.parentAccountId) continue;
    inEstateByCategory[a.category].push(a);
  }
  // Top-level liabilities only — children render under their parent business.
  // Filters the MERGED rows, not the raw prop: overlaying after the filter
  // would drop every optimistic value on the way to the rows that render.
  const topLevelLiabilities = pendingLiabilities.rows.filter((l) => !l.parentAccountId);

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
  // Merged rows, so the panel total and the net-worth KPI move with an inline
  // balance edit instead of lagging a round-trip behind the row above them.
  const totalLiabilities = pendingLiabilities.rows.reduce((s, l) => s + currentYearBalance(l), 0);
  const netWorth = totalInEstate - totalLiabilities;
  // In-estate holdings in the engine's liquid portfolio buckets. Derived from
  // LIQUID_PORTFOLIO_CATEGORIES rather than `isLiquid` — that predicate answers
  // "may this account join a savings/withdrawal group", a narrower question, and
  // borrowing it here silently dropped annuities and life-insurance cash value
  // from a KPI that carries the same name as the cash-flow report's column.
  const liquidAccounts = inEstate.filter((a) =>
    LIQUID_PORTFOLIO_CATEGORIES.has(a.category),
  );
  const portfolioAssets = liquidAccounts.reduce((s, a) => s + Number(a.value), 0);
  const realEstateAccounts = accounts
    .filter((a) => a.category === "real_estate")
    .map((a) => ({ id: a.id, name: a.name }));
  // Top-level business accounts that can serve as parents on add/edit
  // account/liability forms. Excludes nested businesses (defensive — Phase 4
  // doesn't currently support business-under-business).
  const businessOptions = accounts
    .filter((a) => a.category === "business" && a.parentAccountId == null)
    .map((a) => ({ id: a.id, name: a.name }));
  // Household Roth IRA accounts offered as a 529→Roth SECURE 2.0 rollover
  // destination on the education_savings form.
  const rothIraAccounts = accounts
    .filter((a) => a.category === "retirement" && a.subType === "roth_ira")
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

  /**
   * Owner label straight off the ownership relation.
   *
   * Distinct from `ownerDisplay(a: AccountRow)` above, which reads the account
   * row's DERIVED `owner` string. Notes receivable and liabilities carry no
   * such string, so both read the relation instead — hence one helper rather
   * than two near-identical ones.
   */
  function ownerLabelFromOwners(owners: AccountOwner[] | undefined): string {
    const list = owners ?? [];
    if (list.length === 0) return "—";
    const first = list[0];
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

  function noteOwnerDisplay(n: NoteReceivable): string {
    return ownerLabelFromOwners(n.owners);
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
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <Kpi label="Assets (in estate)" value={fmt(totalInEstate)} accent="text-gray-100" />
          <Kpi
            label="Portfolio assets"
            value={fmt(portfolioAssets)}
            accent="text-gray-100"
            subtitle={liquidAccounts.length ? `${liquidAccounts.length} liquid account${liquidAccounts.length > 1 ? "s" : ""}` : "—"}
          />
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
              {canEdit && (nonNoteAccounts.length > 0 || noteRows.length > 0) && (
                <EditToggle on={assetsEdit} onToggle={() => setAssetsEdit((v) => !v)} />
              )}
              {canEdit && <AddAssetMenu onPick={(cat) => cat === "business" ? openAddBusiness() : setAddCategory(cat)} />}
            </div>
          }
        >
          {inEstate.length === 0 &&
          education529s.length === 0 &&
          inEstateBusinessEntityRows.length === 0 &&
          noteRows.length === 0 ? (
            <EmptyRow message="No assets yet. Click Add Asset to get started." />
          ) : (
            CATEGORY_ORDER.map((cat) => {
              // 529s live in this card for visibility but are out-of-estate,
              // so they come from their own list, not inEstateByCategory.
              const items =
                cat === "education_savings" ? education529s : inEstateByCategory[cat];
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
                  tag={cat === "education_savings" ? "Out of estate" : undefined}
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
                        onClickRow={canEdit ? () => !assetsEdit && openEditBusiness(a) : undefined}
                        onDeleteRow={canEdit ? () => setDeletingAccount(a) : undefined}
                        onClickChild={canEdit ? (child) => handleAccountClick(child) : undefined}
                        onDeleteChild={canEdit ? (child) => setDeletingAccount(child) : undefined}
                        onClickChildLiability={canEdit ? (l) => !liabilitiesEdit && setEditingLiability(l) : undefined}
                        editMode={canEdit && assetsEdit}
                        ownerDisplay={ownerDisplay}
                        growthDisplay={growthDisplay}
                        currentYearBalance={currentYearBalance}
                      />
                    ) : (
                      <Row
                        key={a.id}
                        editMode={canEdit && assetsEdit}
                        onDelete={canEdit ? () => setDeletingAccount(a) : undefined}
                        onEdit={canEdit ? () => handleAccountClick(a) : undefined}
                        deletable={!a.isDefaultChecking}
                        label={a.name}
                        labelBadge={
                          a.linkedSource ? <LinkedSourceBadge source={a.linkedSource} /> : undefined
                        }
                        // Owner and growth moved into their own cells; the
                        // beneficiary has no cell, so 529 rows keep a subLabel
                        // reduced to just that name.
                        subLabel={
                          cat === "education_savings"
                            ? `${a.beneficiaryDisplayName ?? "Unnamed beneficiary"} (beneficiary)`
                            : undefined
                        }
                        ownerSlot={
                          <InlineOwnerCell
                            owners={a.owners}
                            titlingType={a.titlingType ?? "jtwros"}
                            parentAccountId={a.parentAccountId}
                            familyMembers={familyMembers ?? []}
                            entities={entities}
                            retirementMode={a.category === "retirement"}
                            display={ownerDisplay(a)}
                            label={`owner for ${a.name}`}
                            canEdit={canEdit}
                            onSave={({ owners, titlingType }) =>
                              saveAccountField(a.id, { owners, titlingType })
                            }
                          />
                        }
                        // Always rendered when the context is there, including
                        // life insurance: `growthEditModeFor` already answers
                        // "none" for it and the cell falls back to a read-only
                        // span. Returning null instead would drop the
                        // fixed-width cell and shift the value column out of
                        // alignment with every sibling row.
                        rateSlot={
                          growthContext && categoryDefaultRates ? (
                            <GrowthRateCell
                              row={a}
                              growthContext={growthContext}
                              categoryDefaultRates={categoryDefaultRates}
                              // Falls back to the context's own rate only to
                              // satisfy the optional prop — on the Net Worth
                              // page both are built from the same resolve.
                              resolvedInflationRate={
                                resolvedInflationRate ?? growthContext.resolvedInflationRate
                              }
                              canEdit={canEdit}
                              onSave={(patch) => saveAccountField(a.id, patch)}
                            />
                          ) : undefined
                        }
                        valueSlot={
                          // A linked account's value is owned by the integration
                          // — editing it here would be overwritten on the next
                          // sync without warning.
                          //
                          // A stock_options account's is owned by its grants for
                          // the same reason: the number shown is derived from
                          // them, so an edit here would be silently recomputed
                          // away on the next render. Change the grants instead.
                          canEdit && a.linkedSource == null && a.category !== "stock_options" ? (
                            <InlineAmount
                              amount={Number(a.value)}
                              label={a.name}
                              onSave={(next) => saveAccountField(a.id, { value: String(next) })}
                            />
                          ) : undefined
                        }
                        value={fmt(a.value)}
                      />
                    ),
                  )}
                  {noteCatRows.map(({ note, value }) => (
                    <Row
                      key={note.id}
                      onClick={canEdit ? () => handleNoteClick(note) : undefined}
                      editMode={canEdit && assetsEdit}
                      onDelete={canEdit ? () => setDeletingNote(note) : undefined}
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
              {canEdit && liabilities.length > 0 && (
                <EditToggle on={liabilitiesEdit} onToggle={() => setLiabilitiesEdit((v) => !v)} />
              )}
              {canEdit && (
                <AddLiabilityDialog
                  clientId={clientId}
                  realEstateAccounts={realEstateAccounts}
                  entities={entities}
                  businesses={businessOptions}
                  familyMembers={familyMembers}
                  clientFirstName={ownerNames.clientName.split(" ")[0]}
                  spouseFirstName={ownerNames.spouseName?.split(" ")[0]}
                />
              )}
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
                    editMode={canEdit && liabilitiesEdit}
                    onDelete={canEdit ? () => setDeletingLiability(l) : undefined}
                    onEdit={canEdit ? () => setEditingLiability(l) : undefined}
                    label={l.name}
                    labelBadge={
                      l.linkedSource ? <LinkedSourceBadge source={l.linkedSource} /> : undefined
                    }
                    // The interest rate moved into its own cell; the old
                    // "4.00% interest" subLabel would just repeat it.
                    ownerSlot={
                      // TITLING EXCEPTION. `InlineOwnerCell` requires a
                      // `titlingType`, but `LiabilityRow` has no such column
                      // and `LiabilityPatch` cannot express one — so the
                      // constant below is inert and the returned titlingType
                      // is deliberately DISCARDED. This is the one exception
                      // to "titlingType always travels with owners": that rule
                      // exists because joint vs community property flips an
                      // ASSET's basis treatment (§1014(b)(6) full step-up vs
                      // §2040(b) 50/50). A liability has no basis and no
                      // step-up, so there is nothing to flip; writing the key
                      // would invent a column.
                      <InlineOwnerCell
                        owners={l.owners}
                        titlingType="jtwros"
                        parentAccountId={l.parentAccountId}
                        familyMembers={familyMembers ?? []}
                        entities={entities}
                        display={ownerLabelFromOwners(l.owners)}
                        label={`owner for ${l.name}`}
                        canEdit={canEdit}
                        onSave={({ owners }) => saveLiabilityField(l.id, { owners })}
                      />
                    }
                    rateSlot={
                      canEdit ? (
                        <InlineAmount
                          mode="percent"
                          noun="interest rate"
                          amount={Number(l.interestRate) * 100}
                          label={l.name}
                          onSave={(pct) =>
                            saveLiabilityField(l.id, { interestRate: String(pct / 100) })
                          }
                          className="min-w-[56px] rounded-sm px-1 py-0.5 text-right tabular text-[11px] text-ink-3 hover:bg-card-hover hover:text-ink-2"
                        />
                      ) : (
                        // A read-only span, NOT undefined. `Row` renders the
                        // fixed-width rate cell only when the slot is truthy,
                        // so dropping it would hide the rate from view-only
                        // users AND shift the value column out of alignment
                        // with every sibling row. (Asset rows avoid this
                        // because `GrowthRateCell` handles read-only itself.)
                        <span className="tabular text-[11px] text-ink-3">
                          {(Number(l.interestRate) * 100).toFixed(2)}%
                        </span>
                      )
                    }
                    valueSlot={
                      // A linked liability's balance is owned by the
                      // integration — editing it here would be overwritten on
                      // the next sync without warning.
                      canEdit && l.linkedSource == null ? (
                        // `amount` and `format` deliberately show DIFFERENT
                        // numbers. `amount` is the stored as-of principal —
                        // the column the write lands in. `format` reproduces
                        // what this row has always displayed: the projected
                        // current-year balance, which `currentYearBalance`
                        // back-solves and amortizes to LAST year's ending
                        // balance. Editing the amortized figure would write it
                        // straight back over the principal and corrupt it.
                        // The red comes through `className` because `Row`
                        // applies `valueClassName` only to the fallback span.
                        <InlineAmount
                          amount={Number(l.balance)}
                          label={l.name}
                          format={() => `(${fmt(currentYearBalance(l))})`}
                          onSave={(next) =>
                            saveLiabilityField(l.id, { balance: String(Math.abs(next)) })
                          }
                          className="min-w-[88px] rounded-sm px-1.5 py-0.5 text-right text-sm font-medium text-red-400 hover:bg-card-hover hover:ring-1 hover:ring-inset hover:ring-hair-2"
                        />
                      ) : undefined
                    }
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
                          onClick={canEdit ? () => handleAccountClick(a) : undefined}
                          className={`flex items-center justify-between px-4 py-2 ${canEdit ? "cursor-pointer hover:bg-gray-800/60" : ""}`}
                        >
                          <div className="min-w-0">
                            <div className="flex min-w-0 items-center gap-1.5">
                              <span className="truncate text-sm font-medium text-gray-100">{a.name}</span>
                              {a.linkedSource && <LinkedSourceBadge source={a.linkedSource} />}
                            </div>
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

      {/* Price refresh — a page-level utility, not an Assets-panel action, so it
       *  sits at the foot of the page below every balance-sheet section. Hidden
       *  in the guided walkthrough: the wizard is for entering accounts, and a
       *  market-data pull there is a distraction from the step's one job. */}
      {!isWizard && canEdit && nonNoteAccounts.length > 0 && (
        // The tooltip is a SIBLING of the button, never a child: a nested button
        // would append its "Show help" label to this one's accessible name and
        // break `getByRole("button", /refresh prices/)`.
        <div className="flex items-center gap-1.5 border-t border-hair pt-4">
          <button
            type="button"
            onClick={handleRefreshPrices}
            disabled={refreshingPrices}
            className="rounded-md border border-hair bg-card px-3 py-1.5 text-sm font-medium text-ink hover:bg-card-hover disabled:opacity-50"
          >
            {refreshingPrices ? "Refreshing…" : "Refresh prices"}
          </button>
          <FieldTooltip text="Looks up the latest closing price for every holding with a ticker symbol on this client's accounts, then re-values any account that tracks its holdings. Prices also refresh on their own each night — use this to pull them in now." />
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
        rothIraAccounts={rothIraAccounts}
        familyMembers={familyMembers}
        categoryDefaults={categoryDefaults}
        modelPortfolios={modelPortfolios}
        fundPortfolios={fundPortfolios}
        ownerNames={ownerNames}
        salaries={salaryOptions}
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
        rothIraAccounts={rothIraAccounts}
        familyMembers={familyMembers}
        categoryDefaults={categoryDefaults}
        modelPortfolios={modelPortfolios}
        fundPortfolios={fundPortfolios}
        ownerNames={ownerNames}
        salaries={salaryOptions}
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

function EmptyRow({ message }: { message: string }) {
  return <div className="px-4 py-8 text-center text-sm text-gray-400">{message}</div>;
}
