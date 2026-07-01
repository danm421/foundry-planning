"use client";

import { useState, useEffect, useRef, useMemo, useCallback, forwardRef, useImperativeHandle } from "react";
import { useRouter } from "next/navigation";
import { useScenarioWriter } from "@/hooks/use-scenario-writer";
import { AssetMixTab, type AssetClassOption } from "./asset-mix-tab";
import { HoldingsTab } from "./holdings-tab";
import { setAccountDeriveFromHoldings } from "@/lib/investments/holdings-client";
import type { GrowthSource } from "@/lib/investments/allocation";
import BeneficiariesTab from "./beneficiaries-tab";
import GrantsTab from "./equity/grants-tab";
import { CurrencyInput } from "@/components/currency-input";
import { PercentInput } from "@/components/percent-input";
import MilestoneYearPicker from "@/components/milestone-year-picker";
import type { YearRef, ClientMilestones } from "@/lib/milestones";
import type { SaveResult } from "@/lib/use-tab-auto-save";
import { useTabAutoSave } from "@/lib/use-tab-auto-save";
import TabAutoSaveIndicator from "../tab-auto-save-indicator";
import { defaultSavingsRuleRefs, resolveMilestone } from "@/lib/milestones";
import SavingsRuleDialog, { type SavingsRuleRow } from "./savings-rule-dialog";
import SavingsRulesList from "./savings-rules-list";
import GrowthSourceRadio from "./growth-source-radio";
import EmployerMatchFields, {
  type MatchMode,
  supportsEmployerMatch,
} from "./employer-match-fields";
import ContributionAmountFields, {
  type ContributionMode,
  supportsPercentContribution,
  supportsMaxContribution,
} from "./contribution-amount-fields";
import DeductibleContributionCheckbox, {
  supportsDeductibility,
  defaultDeductibleForSubtype,
} from "./deductible-contribution-checkbox";
import ContributionCapCheckbox, {
  supportsContributionCap,
} from "./contribution-cap-checkbox";
import { inputClassName, selectClassName, fieldLabelClassName } from "./input-styles";
import { GrowthRateField, parseGrowthSourceSelection, ASSET_MIX_CATEGORIES } from "./growth-rate-field";
import type { FundPortfolioOption } from "@/lib/investments/load-fund-portfolio-options";
import { OwnershipEditor } from "./ownership-editor";
import type { AccountOwner } from "@/engine/ownership";
import { isRmdEligibleSubType } from "@/engine/rmd";
import { RETIREMENT_SUBTYPES } from "@/lib/ownership";

const isRetirementSubType = (st: string) =>
  (RETIREMENT_SUBTYPES as readonly string[]).includes(st);

type AccountCategory = "taxable" | "cash" | "retirement" | "annuity" | "real_estate" | "business" | "life_insurance" | "notes_receivable" | "stock_options";

export interface AccountFormInitial {
  id: string;
  name: string;
  category: AccountCategory;
  subType: string;
  hsaCoverage?: "self" | "family" | null;
  owner: string;
  value: string;
  basis: string;
  /** For 401k/403b only — Roth-designated portion of `value`. */
  rothValue?: string;
  // null means "use the default for this category" from plan_settings
  growthRate: string | null;
  rmdEnabled?: boolean | null;
  /** Optional Dec-31 prior balance used for Year-1 RMD calculation. Stored as
   * a decimal string (or null when unset). Only meaningful for RMD-eligible
   * retirement accounts. */
  priorYearEndValue?: string | null;
  ownerEntityId?: string | null;
  owners?: AccountOwner[];
  /** Joint-titling regime. Drives §1014(b)(6) full step-up vs §2040(b) 50/50. */
  titlingType?: "jtwros" | "community_property";
  annualPropertyTax?: string;
  propertyTaxGrowthRate?: string;
  propertyTaxGrowthSource?: string;
  growthSource?: string;
  deriveFromHoldings?: boolean;
  modelPortfolioId?: string | null;
  tickerPortfolioId?: string | null;
  turnoverPct?: string;
  overridePctOi?: string | null;
  overridePctLtCg?: string | null;
  overridePctQdiv?: string | null;
  overridePctTaxExempt?: string | null;
  /** When true, the account is the auto-provisioned household cash account
   * and cannot be deleted (the projection engine uses it as the default
   * deposit/expense target). */
  isDefaultChecking?: boolean;
  /** Parent business account when this account is a sub-asset of a business. */
  parentAccountId?: string | null;
  custodian?: string | null;
  accountNumberLast4?: string | null;
  /** Future-activation year (null ⇒ active today). */
  activationYear?: number | null;
  activationYearRef?: YearRef | null;
}

export interface BusinessOption {
  id: string;
  name: string;
}

export interface ModelPortfolioOption {
  id: string;
  name: string;
  blendedReturn: number;
}

export interface EntityOption {
  id: string;
  name: string;
  /** Extra fields consumed by the balance sheet OOE section; forms ignore them. */
  entityType?: string;
  value?: string;
  /** Per-family-member ownership shares for business entities (sourced from
   *  entity_owners). The balance sheet uses these to split a business entity's
   *  flat value between in-estate (family-owned share) and out-of-estate
   *  (residual). Trusts and foundations leave this undefined. */
  owners?: Array<{ familyMemberId: string; percent: number }>;
}

export interface CategoryDefaults {
  taxable: string;
  cash: string;
  retirement: string;
  annuity: string;
  real_estate: string;
  business: string;
  life_insurance: string;
  notes_receivable: string;
  stock_options?: string;
}

export interface AccountFormAutoSaveHandle {
  saveAsync: () => Promise<SaveResult & { recordId?: string }>;
}

interface AddAccountFormProps {
  clientId: string;
  category?: AccountCategory;
  mode?: "create" | "edit";
  initial?: AccountFormInitial;
  entities?: EntityOption[];
  /** Top-level business accounts that may own this account. Source:
   *  accounts.filter(a => a.category === "business" && a.parentAccountId == null). */
  businesses?: BusinessOption[];
  familyMembers?: { id: string; role: "client" | "spouse" | "child" | "other"; firstName: string }[];
  categoryDefaults?: CategoryDefaults;
  /** Real names used in the owner dropdown. Falls back to "Client"/"Spouse" if absent. */
  ownerNames?: { clientName: string; spouseName: string | null };
  modelPortfolios?: ModelPortfolioOption[];
  fundPortfolios?: FundPortfolioOption[];
  assetClasses?: AssetClassOption[];
  portfolioAllocationsMap?: Record<string, { assetClassId: string; weight: number }[]>;
  categoryDefaultSources?: Record<string, { source: string; portfolioId?: string; portfolioName?: string; blendedReturn?: number }>;
  milestones?: ClientMilestones;
  clientFirstName?: string;
  spouseFirstName?: string;
  /** Existing account names for auto-increment default naming on create. */
  existingAccountNames?: string[];
  resolvedInflationRate?: number;
  initialTab?: "details" | "savings" | "realization" | "asset_mix" | "rmd" | "beneficiaries" | "holdings" | "grants";
  /**
   * When true, only the Beneficiaries tab button renders and all other panels
   * are unmounted. Prevents accidental overwrite when `initial` is a lite shape
   * (zero values) used by the Beneficiary Summary deep-link.
   */
  lockTab?: boolean;
  onSuccess?: () => void;
  /** Called whenever submit-button state changes. Used by DialogShell to drive
   *  the footer button's disabled / loading visuals. */
  onSubmitStateChange?: (state: { canSubmit: boolean; loading: boolean }) => void;
  /** Pushed up whenever the form's dirty/can-save state changes. Drives useTabAutoSave in the dialog. */
  onAutoSaveStateChange?: (state: { isDirty: boolean; canSave: boolean }) => void;
  /** Called after the first successful auto-save, with the persisted account id. */
  onAutoSaved?: (accountId: string) => void;
  /** Seeds the parent-business selection on create when there's no `initial`.
   *  Used by the "+ Add sub-account" button inside the Business dialog so the
   *  new account is owned by the business by default. */
  initialParentAccountId?: string | null;
}

const SUB_TYPE_BY_CATEGORY: Record<AccountCategory, string[]> = {
  taxable: ["brokerage", "trust", "other"],
  cash: ["savings", "checking", "other"],
  retirement: ["traditional_ira", "roth_ira", "401k", "403b", "529", "hsa", "other"],
  annuity: ["other"],
  real_estate: ["primary_residence", "rental_property", "commercial_property"],
  business: ["sole_proprietorship", "partnership", "s_corp", "c_corp", "llc"],
  life_insurance: ["term", "whole_life", "universal_life", "variable_life"],
  // notes_receivable: routed to AddNoteReceivableForm via add-account-dialog;
  // this form never renders for that category. Empty list keeps the Record
  // exhaustive without offering a stale subType option.
  notes_receivable: [],
  stock_options: ["other"],
};

const SUB_TYPE_LABELS: Record<string, string> = {
  brokerage: "Brokerage",
  savings: "Savings",
  checking: "Checking",
  traditional_ira: "Traditional IRA",
  roth_ira: "Roth IRA",
  "401k": "401(k)",
  "403b": "403(b)",
  "529": "529 Plan",
  hsa: "HSA",
  trust: "Trust",
  other: "Other",
  primary_residence: "Primary Residence",
  rental_property: "Rental Property",
  commercial_property: "Commercial Property",
  sole_proprietorship: "Sole Proprietorship",
  partnership: "Partnership",
  s_corp: "S Corp",
  c_corp: "C Corp",
  llc: "LLC",
  term: "Term Life",
  whole_life: "Whole Life",
  universal_life: "Universal Life",
  variable_life: "Variable Life",
};

const CATEGORY_LABELS: Record<AccountCategory, string> = {
  taxable: "Taxable",
  cash: "Cash",
  retirement: "Retirement",
  annuity: "Annuity",
  real_estate: "Real Estate",
  business: "Business",
  life_insurance: "Life Insurance",
  notes_receivable: "Notes Receivable",
  stock_options: "Stock Options",
};

const RETIREMENT_SUB_TYPES = new Set(["traditional_ira", "roth_ira", "401k", "403b", "529", "hsa"]);

// Tabs backed by a nested resource keyed on the account id (holdings, grants,
// beneficiaries). Opening one on a not-yet-saved account force-creates the
// account first so the tab is immediately usable — no save + reopen.
const RECORD_DEPENDENT_TABS = new Set(["holdings", "grants", "beneficiaries"]);

const DEFAULT_NAME_BY_CATEGORY: Record<AccountCategory, string> = {
  taxable: "Taxable Account",
  cash: "Cash Account",
  retirement: "Retirement Account",
  annuity: "Annuity",
  real_estate: "Real Estate",
  business: "Business Interest",
  life_insurance: "Life Insurance Policy",
  // notes_receivable: routed to AddNoteReceivableForm via add-account-dialog;
  // this form never renders for that category. Entry kept only to satisfy
  // Record<AccountCategory, string> exhaustiveness.
  notes_receivable: "Promissory Note",
  stock_options: "Stock Options",
};

function uniqueAccountName(base: string, existing: string[]): string {
  const taken = new Set(existing.map((n) => n.trim().toLowerCase()));
  if (!taken.has(base.trim().toLowerCase())) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base} ${i}`;
    if (!taken.has(candidate.trim().toLowerCase())) return candidate;
  }
  return base;
}

const AddAccountForm = forwardRef<AccountFormAutoSaveHandle, AddAccountFormProps>(function AddAccountForm({
  clientId,
  category: defaultCategory,
  mode = "create",
  initial,
  entities,
  businesses,
  familyMembers = [],
  categoryDefaults,
  ownerNames,
  modelPortfolios,
  fundPortfolios,
  assetClasses,
  portfolioAllocationsMap,
  categoryDefaultSources,
  milestones,
  clientFirstName,
  spouseFirstName,
  existingAccountNames,
  resolvedInflationRate = 0,
  initialTab,
  lockTab,
  onSuccess,
  onSubmitStateChange,
  onAutoSaveStateChange,
  onAutoSaved,
  initialParentAccountId,
}, ref) {
  const router = useRouter();
  const writer = useScenarioWriter(clientId);
  const isEdit = mode === "edit" && !!initial;

  // Tracks the server-assigned id for accounts that start as "create" but have
  // been auto-saved at least once (first save mints the row and returns the id).
  const [effectiveAccountId, setEffectiveAccountId] = useState<string | null>(initial?.id ?? null);

  // Auto-focus + select-all the Name input on create so the advisor can start
  // typing to replace any default. Skipped on edit and when the dialog is
  // deep-linked to a non-Details tab (`lockTab`), since the input isn't
  // visible in that case.
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (isEdit || lockTab) return;
    const el = nameInputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [isEdit, lockTab]);

  const [accountSavingsRules, setAccountSavingsRules] = useState<SavingsRuleRow[]>([]);
  const [srDialogOpen, setSrDialogOpen] = useState(false);
  const [srDialogEditing, setSrDialogEditing] = useState<SavingsRuleRow | undefined>(undefined);
  const [deletingSr, setDeletingSr] = useState<SavingsRuleRow | null>(null);

  useEffect(() => {
    if (!isEdit || !initial?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/savings-rules`);
        if (!res.ok) return;
        const rows: SavingsRuleRow[] = await res.json();
        if (!cancelled) setAccountSavingsRules(rows.filter((r) => r.accountId === initial.id));
      } catch {
        // silent; the tab just shows an empty list
      }
    })();
    return () => { cancelled = true; };
  }, [clientId, initial?.id, isEdit]);

  const [loading, setLoading] = useState(false);

  // Lift submit-button state into the parent dialog so DialogShell can drive
  // the footer primary button's disabled/loading visuals.
  useEffect(() => {
    onSubmitStateChange?.({
      canSubmit: !loading,
      loading,
    });
  }, [loading, onSubmitStateChange]);

  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<AccountCategory>(
    initial?.category ?? defaultCategory ?? "taxable"
  );

  // Controlled account name. On create, defaults to an auto-incremented
  // category label (e.g., "Taxable Account 2"). Tracks whether the user has
  // typed anything so category changes only auto-rename while the name is
  // still the auto-generated default.
  const existingNamesList = existingAccountNames ?? [];
  const initialCategoryForName = initial?.category ?? defaultCategory ?? "taxable";
  const [name, setName] = useState<string>(
    initial?.name ??
      uniqueAccountName(DEFAULT_NAME_BY_CATEGORY[initialCategoryForName], existingNamesList),
  );
  const [userEditedName, setUserEditedName] = useState<boolean>(mode === "edit");

  // Controlled value + basis so basis can mirror value until the user edits it
  // manually (defaulting tax basis to the full current value on create).
  const [accountValue, setAccountValue] = useState<string>(
    initial?.value != null ? String(initial.value) : "0",
  );
  const [accountBasis, setAccountBasis] = useState<string>(
    initial?.basis != null ? String(initial.basis) : "0",
  );
  const [userEditedBasis, setUserEditedBasis] = useState<boolean>(mode === "edit");
  // 401k/403b only — Roth-designated portion of value. Defaults to 0
  // (regular pre-tax 401k) and is independent from the basis field.
  const [accountRothValue, setAccountRothValue] = useState<string>(
    initial?.rothValue != null ? String(initial.rothValue) : "",
  );
  const [activeTab, setActiveTab] = useState<"details" | "savings" | "realization" | "asset_mix" | "rmd" | "beneficiaries" | "holdings" | "grants">(
    initialTab ?? "details",
  );
  const [subType, setSubType] = useState(
    initial?.subType ?? SUB_TYPE_BY_CATEGORY[defaultCategory ?? "taxable"][0]
  );
  const [rmdEnabled, setRmdEnabled] = useState<boolean>(
    initial?.rmdEnabled ?? isRmdEligibleSubType(
      initial?.subType ?? SUB_TYPE_BY_CATEGORY[defaultCategory ?? "taxable"][0]
    )
  );
  const [hsaCoverage, setHsaCoverage] = useState<"self" | "family">(
    (initial?.hsaCoverage as "self" | "family") ?? "self"
  );
  const [priorYearEndValue, setPriorYearEndValue] = useState<string>(
    initial?.priorYearEndValue ?? "",
  );
  const [annualPropertyTax, setAnnualPropertyTax] = useState(initial?.annualPropertyTax ?? "0");
  const [propertyTaxGrowthRate, setPropertyTaxGrowthRate] = useState(
    initial?.propertyTaxGrowthRate != null ? (Number(initial.propertyTaxGrowthRate) * 100).toString() : "3"
  );
  const [propertyTaxGrowthSource, setPropertyTaxGrowthSource] = useState<"custom" | "inflation">(
    initial?.propertyTaxGrowthSource === "inflation" ? "inflation" : "custom",
  );
  // Controlled custom rate for real estate value growth — preserved across
  // inflation/custom toggles so the typed value isn't lost.
  const [realEstateGrowthRatePct, setRealEstateGrowthRatePct] = useState<string>(() => {
    if (initial?.category === "real_estate" && initial.growthRate != null && initial.growthRate !== "") {
      return (Number(initial.growthRate) * 100).toString();
    }
    return "3";
  });

  // Owner selection: AccountOwner[] driven by OwnershipEditor.
  const clientFm = familyMembers.find((fm) => fm.role === "client");
  const defaultOwners: AccountOwner[] = clientFm
    ? [{ kind: "family_member", familyMemberId: clientFm.id, percent: 1 }]
    : [];
  const [owners, setOwners] = useState<AccountOwner[]>(
    initial?.owners && initial.owners.length > 0 ? initial.owners : defaultOwners,
  );
  const [titlingType, setTitlingType] = useState<"jtwros" | "community_property">(
    initial?.titlingType ?? "jtwros",
  );
  // Phase 4: when set, this account is a sub-asset of the chosen business.
  // OwnershipEditor hides and owners[] is sent as []. Mutually exclusive
  // with individual owners.
  const [parentBusinessId, setParentBusinessId] = useState<string | null>(
    initial?.parentAccountId ?? initialParentAccountId ?? null,
  );

  // The auto-provisioned household cash account is system-managed: category,
  // sub-type, parent (sub-account), and ownership are all locked. Deletion is
  // already blocked by the DELETE route + balance sheet UI.
  const isSystemManagedCash = initial?.isDefaultChecking === true;

  // Growth source: "default" (category default), "model_portfolio", or "custom"
  const isInvestable = ["taxable", "cash", "retirement"].includes(category);
  const [growthSource, setGrowthSource] = useState<GrowthSource>(
    (initial?.growthSource as GrowthSource) ?? "default"
  );
  // Real estate uses its own source toggle (custom vs. plan inflation). Stored
  // in the same `growth_source` column on save.
  const [realEstateGrowthSource, setRealEstateGrowthSource] = useState<"custom" | "inflation">(
    initial?.category === "real_estate" && initial?.growthSource === "inflation" ? "inflation" : "custom",
  );
  const [modelPortfolioId, setModelPortfolioId] = useState<string>(
    initial?.modelPortfolioId ?? ""
  );
  const [tickerPortfolioId, setTickerPortfolioId] = useState<string>(
    initial?.tickerPortfolioId ?? ""
  );
  const [customAllocations, setCustomAllocations] = useState<{ assetClassId: string; weight: number }[]>([]);
  const [allocationsLoaded, setAllocationsLoaded] = useState(false);
  const [holdingsTotals, setHoldingsTotals] = useState<{ value: number; basis: number } | null>(null);
  const [deriveFromHoldings, setDeriveFromHoldings] = useState<boolean>(
    (initial as { deriveFromHoldings?: boolean } | undefined)?.deriveFromHoldings ?? true,
  );
  // The account is actually driven by its holdings only when the opt-in flag is
  // on AND there are holdings to derive from (totals reported by the Holdings tab).
  const drivenByHoldings = deriveFromHoldings && holdingsTotals != null;
  // Controlled state for previously-uncontrolled fields. Conversion from
  // `defaultValue` is a prerequisite for tab-switch auto-save (the save path
  // needs to read these without scraping FormData) — and it also closes a
  // latent bug where the Realization tab's values weren't tracked in React
  // state, so they couldn't participate in dirty-tracking.
  const [growthRatePct, setGrowthRatePct] = useState<string>(() => {
    if (initial?.growthRate != null && initial.growthRate !== "") {
      return (Number(initial.growthRate) * 100).toString();
    }
    const cat = initial?.category ?? defaultCategory ?? "taxable";
    const def = categoryDefaultSources?.[cat]?.blendedReturn;
    return def != null ? String(def) : "7";
  });
  const [overridePctOi, setOverridePctOi] = useState<string>(
    initial?.overridePctOi ? (Number(initial.overridePctOi) * 100).toFixed(2) : "",
  );
  const [overridePctLtCg, setOverridePctLtCg] = useState<string>(
    initial?.overridePctLtCg ? (Number(initial.overridePctLtCg) * 100).toFixed(2) : "",
  );
  const [overridePctQdiv, setOverridePctQdiv] = useState<string>(
    initial?.overridePctQdiv ? (Number(initial.overridePctQdiv) * 100).toFixed(2) : "",
  );
  const [overridePctTaxExempt, setOverridePctTaxExempt] = useState<string>(
    initial?.overridePctTaxExempt ? (Number(initial.overridePctTaxExempt) * 100).toFixed(2) : "",
  );
  const [turnoverPct, setTurnoverPct] = useState<string>(
    initial?.turnoverPct ? (Number(initial.turnoverPct) * 100).toFixed(2) : "0",
  );
  const [custodian, setCustodian] = useState<string>(initial?.custodian ?? "");
  const [accountNumberLast4, setAccountNumberLast4] = useState<string>(
    initial?.accountNumberLast4 ?? "",
  );

  // ── Stock Options equity state (gated: only used when category === "stock_options") ──
  const [ticker, setTicker] = useState<string>("");
  const [isPublic, setIsPublic] = useState<boolean>(false);
  const [pricePerShare, setPricePerShare] = useState<string>("0");
  const [destinationAccountId] = useState<string | null>(null); // forward-compat; picker deferred
  const [autoCreateDestination, setAutoCreateDestination] = useState<boolean>(true);
  const [sellToCover, setSellToCover] = useState<boolean>(true);
  const [withholdingRate, setWithholdingRate] = useState<string>("22"); // percent display (22 = 22%)
  const [defaultExerciseTiming, setDefaultExerciseTiming] = useState<string>("at_vest");
  const [defaultExerciseYear, setDefaultExerciseYear] = useState<string>("");
  const [defaultSellTiming, setDefaultSellTiming] = useState<string>("hold");
  const [defaultSellYear, setDefaultSellYear] = useState<string>("");
  const [defaultSellPercentPerYear, setDefaultSellPercentPerYear] = useState<string>("");
  const [defaultSellStartYear, setDefaultSellStartYear] = useState<string>("");

  // Edit-mode seeding for equity fields — fetch the stock-option-accounts list
  // and seed from the extension matching initial.id.
  useEffect(() => {
    if (mode !== "edit" || !initial?.id || initial.category !== "stock_options") return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/stock-option-accounts`);
        if (!res.ok) return;
        const { stockOptionAccounts: rows = [] } = (await res.json()) as {
          stockOptionAccounts: Array<{
          account: { id: string };
          extension: {
            ticker?: string | null;
            isPublic?: boolean | null;
            pricePerShare?: string | null;
            autoCreateDestination?: boolean | null;
            sellToCover?: boolean | null;
            withholdingRate?: string | null;
            defaultExerciseTiming?: string | null;
            defaultExerciseYear?: number | string | null;
            defaultSellTiming?: string | null;
            defaultSellYear?: number | string | null;
            defaultSellPercentPerYear?: string | null;
            defaultSellStartYear?: number | string | null;
          };
        }>;
        };
        if (cancelled) return;
        const match = rows.find((r) => r.account.id === initial.id);
        if (!match) return;
        const ext = match.extension;
        if (ext.ticker != null) setTicker(ext.ticker);
        if (ext.isPublic != null) setIsPublic(ext.isPublic);
        if (ext.pricePerShare != null) setPricePerShare(ext.pricePerShare);
        if (ext.autoCreateDestination != null) setAutoCreateDestination(ext.autoCreateDestination);
        if (ext.sellToCover != null) setSellToCover(ext.sellToCover);
        if (ext.withholdingRate != null)
          setWithholdingRate(String(+(Number(ext.withholdingRate) * 100).toFixed(6)));
        if (ext.defaultExerciseTiming != null) setDefaultExerciseTiming(ext.defaultExerciseTiming);
        if (ext.defaultExerciseYear != null) setDefaultExerciseYear(String(ext.defaultExerciseYear));
        if (ext.defaultSellTiming != null) setDefaultSellTiming(ext.defaultSellTiming);
        if (ext.defaultSellYear != null) setDefaultSellYear(String(ext.defaultSellYear));
        if (ext.defaultSellPercentPerYear != null)
          setDefaultSellPercentPerYear(String(+(Number(ext.defaultSellPercentPerYear) * 100).toFixed(6)));
        if (ext.defaultSellStartYear != null)
          setDefaultSellStartYear(String(ext.defaultSellStartYear));
      } catch {
        // silent; fields remain at defaults
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Future-activation year — account doesn't exist in the projection until
  // this year (inheritance, planned new account, etc.). Declared ahead of
  // `currentSerialized` below (which references it) rather than alongside
  // the savings-year state further down, which runs after this useMemo.
  const [activationEnabled, setActivationEnabled] = useState<boolean>(
    initial?.activationYear != null || initial?.activationYearRef != null,
  );
  const [activationYear, setActivationYear] = useState<number>(
    initial?.activationYear ?? new Date().getFullYear(),
  );
  const [activationYearRef, setActivationYearRef] = useState<YearRef | null>(
    initial?.activationYearRef ?? null,
  );

  // ── Dirty-tracking for autosave ─────────────────────────────────────────────
  // Serialize every controlled field into a snapshot string so tab-switch
  // autosave can tell whether there are unsaved changes.
  const currentSerialized = useMemo(() => JSON.stringify({
    name,
    category,
    subType,
    hsaCoverage,
    owners,
    titlingType,
    parentBusinessId,
    accountValue,
    accountBasis,
    accountRothValue,
    growthSource,
    growthRatePct,
    realEstateGrowthSource,
    realEstateGrowthRatePct,
    modelPortfolioId,
    tickerPortfolioId,
    rmdEnabled,
    priorYearEndValue,
    annualPropertyTax,
    propertyTaxGrowthRate,
    propertyTaxGrowthSource,
    overridePctOi,
    overridePctLtCg,
    overridePctQdiv,
    // stock_options equity fields (included for all categories — value is constant for non-equity)
    ticker,
    isPublic,
    pricePerShare,
    autoCreateDestination,
    sellToCover,
    withholdingRate,
    defaultExerciseTiming,
    defaultExerciseYear,
    defaultSellTiming,
    defaultSellYear,
    defaultSellPercentPerYear,
    defaultSellStartYear,
    overridePctTaxExempt,
    turnoverPct,
    customAllocations,
    custodian,
    accountNumberLast4,
    activationEnabled,
    activationYear,
    activationYearRef,
  }), [
    name, category, subType, hsaCoverage, owners, titlingType, parentBusinessId, accountValue, accountBasis,
    accountRothValue, growthSource, growthRatePct, realEstateGrowthSource,
    realEstateGrowthRatePct, modelPortfolioId, tickerPortfolioId, rmdEnabled, priorYearEndValue,
    annualPropertyTax, propertyTaxGrowthRate, propertyTaxGrowthSource,
    overridePctOi, overridePctLtCg, overridePctQdiv, overridePctTaxExempt,
    turnoverPct, customAllocations, custodian, accountNumberLast4,
    ticker, isPublic, pricePerShare, autoCreateDestination, sellToCover,
    withholdingRate, defaultExerciseTiming, defaultExerciseYear, defaultSellTiming,
    defaultSellYear, defaultSellPercentPerYear, defaultSellStartYear,
    activationEnabled, activationYear, activationYearRef,
  ]);

  const baselineRef = useRef<string>("");
  useEffect(() => {
    baselineRef.current = currentSerialized;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isDirty = currentSerialized !== baselineRef.current;
  const canSave = name.trim().length > 0;

  useEffect(() => {
    onAutoSaveStateChange?.({ isDirty, canSave });
  }, [isDirty, canSave, onAutoSaveStateChange]);

  const showAssetMixTab = ASSET_MIX_CATEGORIES.includes(category);

  // Resolve category default info for display
  const catDefaultSource = categoryDefaultSources?.[category];

  useEffect(() => {
    if (allocationsLoaded) return;
    if (mode === "edit" && initial?.id) {
      fetch(`/api/clients/${clientId}/accounts/${initial.id}/allocations`)
        .then((res) => res.json())
        .then((rows: { assetClassId: string; weight: string }[]) => {
          const loaded = rows.map((r) => ({ assetClassId: r.assetClassId, weight: parseFloat(r.weight) }));
          // If no custom allocations saved, pre-fill from the effective portfolio
          if (loaded.length === 0) {
            const effectivePortfolioId = modelPortfolioId || catDefaultSource?.portfolioId;
            if (effectivePortfolioId && portfolioAllocationsMap?.[effectivePortfolioId]) {
              setCustomAllocations(portfolioAllocationsMap[effectivePortfolioId]);
            }
          } else {
            setCustomAllocations(loaded);
          }
          setAllocationsLoaded(true);
        })
        .catch(() => setAllocationsLoaded(true));
    } else if (mode === "create") {
      // Pre-fill from the category default portfolio for new accounts
      const effectivePortfolioId = catDefaultSource?.portfolioId;
      if (effectivePortfolioId && portfolioAllocationsMap?.[effectivePortfolioId]) {
        setCustomAllocations(portfolioAllocationsMap[effectivePortfolioId]);
      }
      setAllocationsLoaded(true);
    }
  }, [mode, initial?.id, clientId, allocationsLoaded, modelPortfolioId, portfolioAllocationsMap, catDefaultSource?.portfolioId]);

  // Re-read the account's allocations from the server. Holdings mutations
  // re-derive the asset mix server-side (syncAccountFromHoldings), so after one
  // we pull the fresh rollup into customAllocations — that's what keeps the
  // Asset Mix tab current without a save + reopen. Base mode only (allocations
  // aren't in scenario scope) and only once the account exists.
  const refreshAllocationsFromServer = useCallback(async () => {
    const acctId = effectiveAccountId;
    if (!acctId || writer.scenarioActive) return;
    try {
      const res = await fetch(`/api/clients/${clientId}/accounts/${acctId}/allocations`);
      if (!res.ok) return;
      const rows = (await res.json()) as { assetClassId: string; weight: string }[];
      setCustomAllocations(rows.map((r) => ({ assetClassId: r.assetClassId, weight: parseFloat(r.weight) })));
    } catch {
      // Leave the current allocations in place on a transient read failure.
    }
  }, [clientId, effectiveAccountId, writer.scenarioActive]);

  const hasExplicitGrowth = initial?.growthRate != null && initial.growthRate !== "";
  const useDefaultGrowth = growthSource === "default";
  const defaultPctForCategory = catDefaultSource?.blendedReturn != null
    ? Math.round(catDefaultSource.blendedReturn * 10000) / 100
    : categoryDefaults
      ? Math.round(Number(categoryDefaults[category]) * 10000) / 100
      : null;

  // Blended return implied by the current custom asset mix. Mirrors the
  // computation in AssetMixTab (weighted geometric return + inflation for any
  // unclassified remainder) so the dropdown can show the resolved rate instead
  // of a bare "custom" label. Null until allocations are loaded/non-empty.
  const assetMixBlendedPct = useMemo(() => {
    if (!assetClasses || customAllocations.length === 0) return null;
    const weightMap = new Map(customAllocations.map((a) => [a.assetClassId, a.weight]));
    let blended = 0;
    let totalAllocated = 0;
    for (const ac of assetClasses) {
      const w = weightMap.get(ac.id) ?? 0;
      blended += w * ac.geometricReturn;
      totalAllocated += w;
    }
    const unclassified = Math.max(0, 1 - totalAllocated);
    const inflationClass = assetClasses.find((ac) => ac.slug === "inflation");
    if (unclassified > 0 && inflationClass) {
      blended += unclassified * inflationClass.geometricReturn;
    }
    return blended * 100;
  }, [assetClasses, customAllocations]);

  const currentYear = new Date().getFullYear();

  // Savings (create-only) year state — enables MilestoneYearPicker fallback.
  // Defaults to plan_start → client_retirement when milestones are available.
  const defaultSavingsRefs = defaultSavingsRuleRefs();
  const initialSavingsStartYear =
    milestones && defaultSavingsRefs.startYearRef
      ? resolveMilestone(defaultSavingsRefs.startYearRef, milestones, "start") ?? currentYear
      : currentYear;
  const initialSavingsEndYear =
    milestones && defaultSavingsRefs.endYearRef
      ? resolveMilestone(defaultSavingsRefs.endYearRef, milestones, "end") ?? currentYear + 20
      : currentYear + 20;
  const [savingsStartYear, setSavingsStartYear] = useState<number>(initialSavingsStartYear);
  const [savingsEndYear, setSavingsEndYear] = useState<number>(initialSavingsEndYear);
  const [savingsStartYearRef, setSavingsStartYearRef] = useState<YearRef | null>(
    milestones ? defaultSavingsRefs.startYearRef : null,
  );
  const [savingsEndYearRef, setSavingsEndYearRef] = useState<YearRef | null>(
    milestones ? defaultSavingsRefs.endYearRef : null,
  );
  const [savingsGrowthSource, setSavingsGrowthSource] = useState<"custom" | "inflation">("inflation");
  const [savingsGrowthRateDisplay, setSavingsGrowthRateDisplay] = useState<string>("0");
  const [matchMode, setMatchMode] = useState<MatchMode>("none");
  const [contribMode, setContribMode] = useState<ContributionMode>("amount");
  const [isDeductible, setIsDeductible] = useState<boolean>(defaultDeductibleForSubtype(subType));
  // Reset the deductibility default whenever the subtype changes in create mode.
  useEffect(() => {
    setIsDeductible(defaultDeductibleForSubtype(subType));
  }, [subType]);
  const [applyContributionLimit, setApplyContributionLimit] = useState<boolean>(true);

  const subTypes = SUB_TYPE_BY_CATEGORY[category];
  const isRetirementAccount = category === "retirement" && RETIREMENT_SUB_TYPES.has(subType);
  const isHsa = category === "retirement" && subType === "hsa";
  const showEmployerMatch = supportsEmployerMatch(category, subType);
  const showContributionModeToggle = supportsPercentContribution(category, subType);
  const showContributionMaxToggle = supportsMaxContribution(category, subType);
  const showDeductibleCheckbox = supportsDeductibility(category, subType);
  const showContributionCapCheckbox = supportsContributionCap(category, subType);
  const showRmdCheckbox =
    category === "retirement" &&
    (subType === "traditional_ira" ||
      subType === "401k" ||
      subType === "403b" ||
      subType === "roth_ira" ||
      subType === "529");

  // Growth rate as percent for the input (stored as decimal fraction).
  // If no explicit value, fall back to the category default for display.
  const initialGrowthPct = hasExplicitGrowth
    ? Math.round(Number(initial!.growthRate) * 10000) / 100
    : defaultPctForCategory ?? 7;

  function handleGrowthSourceChange(v: string) {
    // Choosing any source other than the holdings-seeded asset mix opts out of
    // holdings driving this account (value/basis/mix become editable again).
    const picksAssetMix = v === "asset_mix";
    if (deriveFromHoldings && holdingsTotals != null && !picksAssetMix && effectiveAccountId) {
      setDeriveFromHoldings(false);
      void setAccountDeriveFromHoldings(clientId, effectiveAccountId, false);
    }
    const { growthSource: gs, modelPortfolioId: mp, tickerPortfolioId: tp } = parseGrowthSourceSelection(v);
    setGrowthSource(gs);
    setModelPortfolioId(mp ?? "");
    setTickerPortfolioId(tp ?? "");
    if (gs === "model_portfolio" && mp) {
      const portfolioAllocs = portfolioAllocationsMap?.[mp] ?? [];
      if (portfolioAllocs.length > 0) setCustomAllocations(portfolioAllocs);
    }
  }

  // ── saveEquityAccount ────────────────────────────────────────────────────────
  // Shared equity save helper used by both saveAsyncImpl and handleSubmit.
  // Only called when category === "stock_options". Bypasses the scenario writer
  // and hits the dedicated stock-option-accounts route directly.
  const saveEquityAccount = useCallback(async (): Promise<{ ok: true; id: string } | { ok: false; error: string }> => {
    const firstOwner = owners[0];
    const firstOwnerFmId =
      firstOwner?.kind === "family_member" ? firstOwner.familyMemberId : undefined;
    const ownerFm = familyMembers.find((fm) => fm.id === firstOwnerFmId);
    const owner = ownerFm?.role === "spouse" ? "spouse" : "client";
    const equityBody = {
      name,
      ticker: ticker.trim() === "" ? null : ticker.trim(),
      isPublic,
      pricePerShare: Number(pricePerShare) || 0,
      owner,
      growthRate: null,
      destinationAccountId,
      autoCreateDestination,
      sellToCover,
      withholdingRate: Number(withholdingRate) / 100,
      defaultExerciseTiming,
      defaultExerciseYear:
        defaultExerciseTiming === "specific_year" ? Number(defaultExerciseYear) || null : null,
      defaultSellTiming,
      defaultSellYear:
        defaultSellTiming === "hold_then_sell_year" ? Number(defaultSellYear) || null : null,
      defaultSellPercentPerYear:
        defaultSellTiming === "percent_per_year"
          ? (defaultSellPercentPerYear !== "" ? Number(defaultSellPercentPerYear) / 100 : null)
          : null,
      defaultSellStartYear:
        defaultSellTiming === "percent_per_year" ? Number(defaultSellStartYear) || null : null,
    };
    const targetId = effectiveAccountId;
    const url = targetId
      ? `/api/clients/${clientId}/stock-option-accounts/${targetId}`
      : `/api/clients/${clientId}/stock-option-accounts`;
    try {
      const res = await fetch(url, {
        method: targetId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(equityBody),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as { error?: string };
        return { ok: false, error: j.error ?? "Failed to save stock options account" };
      }
      let id = targetId;
      if (!targetId) {
        const saved = (await res.json()) as { id: string };
        id = saved.id;
        setEffectiveAccountId(saved.id);
        onAutoSaved?.(saved.id);
      }
      return { ok: true, id: id! };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
    }
  }, [
    name, ticker, isPublic, pricePerShare, owners, familyMembers, destinationAccountId,
    autoCreateDestination, sellToCover, withholdingRate, defaultExerciseTiming,
    defaultExerciseYear, defaultSellTiming, defaultSellYear, defaultSellPercentPerYear,
    defaultSellStartYear, effectiveAccountId, clientId, onAutoSaved,
  ]);

  // ── saveAsyncImpl ────────────────────────────────────────────────────────────
  // Shared between the explicit-submit path and tab-switch autosave. Builds the
  // account body from React state (no FormData dependency) and POST/PUTs it.
  // NOTE: savings-rule creation is create-only and requires the savings tab's
  // FormData values — it stays in handleSubmit below, not here.
  const saveAsyncImpl = useCallback(async (): Promise<SaveResult & { recordId?: string }> => {
    if (!canSave) return { ok: false, error: "Please complete required fields before saving." };

    // ── stock_options: bypass the generic accounts route ────────────────────
    if (category === "stock_options") {
      setLoading(true);
      setError(null);
      try {
        const result = await saveEquityAccount();
        if (!result.ok) {
          setError(result.error);
          return { ok: false, error: result.error };
        }
        baselineRef.current = currentSerialized;
        return { ok: true, recordId: result.id };
      } finally {
        setLoading(false);
      }
    }

    let growthRate: string | null;
    if (category === "real_estate") {
      growthRate = String(Number(realEstateGrowthRatePct) / 100);
    } else if (growthSource === "custom") {
      growthRate = String(Number(growthRatePct) / 100);
    } else {
      growthRate = isInvestable ? null : String(Number(growthRatePct) / 100);
    }

    const toPctOrNull = (val: string) =>
      val !== "" && val != null ? String(Number(val) / 100) : null;

    const isMixedDeferral =
      category === "retirement" && (subType === "401k" || subType === "403b");

    // When the account is parented to a business, omit owners[] from the
    // payload entirely — the API rejects owners[] when parentAccountId is
    // set, and inheritance happens through the parent.
    const accountBody = {
      name,
      category,
      subType,
      ...(parentBusinessId ? {} : { owners }),
      titlingType,
      parentAccountId: parentBusinessId,
      value: accountValue,
      basis: isMixedDeferral ? "0" : accountBasis,
      rothValue: isMixedDeferral ? (accountRothValue || "0") : "0",
      growthRate,
      rmdEnabled,
      priorYearEndValue: rmdEnabled && priorYearEndValue !== "" ? priorYearEndValue : null,
      growthSource: isInvestable
        ? growthSource
        : category === "real_estate"
          ? realEstateGrowthSource
          : "custom",
      modelPortfolioId: growthSource === "model_portfolio" ? modelPortfolioId : null,
      tickerPortfolioId: growthSource === "ticker_portfolio" ? tickerPortfolioId : null,
      deriveFromHoldings,
      turnoverPct: toPctOrNull(turnoverPct) ?? "0",
      overridePctOi: toPctOrNull(overridePctOi),
      overridePctLtCg: toPctOrNull(overridePctLtCg),
      overridePctQdiv: toPctOrNull(overridePctQdiv),
      overridePctTaxExempt: toPctOrNull(overridePctTaxExempt),
      annualPropertyTax: category === "real_estate" ? annualPropertyTax : undefined,
      propertyTaxGrowthRate:
        category === "real_estate"
          ? String(Number(propertyTaxGrowthRate) / 100)
          : undefined,
      propertyTaxGrowthSource: category === "real_estate" ? propertyTaxGrowthSource : undefined,
      custodian: custodian.trim() === "" ? null : custodian.trim(),
      accountNumberLast4: accountNumberLast4.trim() === "" ? null : accountNumberLast4.trim(),
      hsaCoverage: isHsa ? hsaCoverage : null,
      activationYear: activationEnabled ? activationYear : null,
      activationYearRef: activationEnabled ? activationYearRef : null,
    };

    setLoading(true);
    setError(null);
    try {
      const targetId = effectiveAccountId;
      if (targetId) {
        // Existing account (edit mode or post-first-autosave)
        const res = await writer.submit(
          {
            op: "edit",
            targetKind: "account",
            targetId,
            desiredFields: accountBody,
          },
          {
            url: `/api/clients/${clientId}/accounts/${targetId}`,
            method: "PUT",
            body: accountBody,
          },
        );
        if (!res.ok) {
          const json = (await res.json().catch(() => ({}))) as { error?: string };
          return { ok: false, error: json.error ?? "Failed to update account" };
        }
        // Don't write allocations when holdings drive the account — the holdings
        // sync owns account_asset_allocations, and PUTting the form's copy would
        // clobber the just-derived rollup with a stale snapshot.
        if (showAssetMixTab && customAllocations.length > 0 && !writer.scenarioActive && !drivenByHoldings) {
          await fetch(`/api/clients/${clientId}/accounts/${targetId}/allocations`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ allocations: customAllocations }),
          });
        }
        baselineRef.current = currentSerialized;
        return { ok: true, recordId: targetId };
      } else {
        // First save for a new account — mint an id and POST
        const newAccountId =
          typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : `tmp-${Date.now()}`;
        const res = await writer.submit(
          {
            op: "add",
            targetKind: "account",
            entity: { id: newAccountId, ...accountBody },
          },
          {
            url: `/api/clients/${clientId}/accounts`,
            method: "POST",
            body: accountBody,
          },
        );
        if (!res.ok) {
          const json = (await res.json().catch(() => ({}))) as { error?: string };
          return { ok: false, error: json.error ?? "Failed to create account" };
        }
        const saved = writer.scenarioActive
          ? { id: newAccountId }
          : (await res.json()) as { id: string };

        if (showAssetMixTab && customAllocations.length > 0 && !writer.scenarioActive && !drivenByHoldings) {
          await fetch(`/api/clients/${clientId}/accounts/${saved.id}/allocations`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ allocations: customAllocations }),
          });
        }

        setEffectiveAccountId(saved.id);
        onAutoSaved?.(saved.id);
        baselineRef.current = currentSerialized;
        return { ok: true, recordId: saved.id };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setError(msg);
      return { ok: false, error: msg };
    } finally {
      setLoading(false);
    }
  }, [
    canSave, subType, category, realEstateGrowthRatePct, growthSource, growthRatePct,
    isInvestable, name, owners, titlingType, parentBusinessId, accountValue, accountBasis, accountRothValue,
    rmdEnabled, priorYearEndValue, realEstateGrowthSource, modelPortfolioId, tickerPortfolioId, deriveFromHoldings,
    turnoverPct, overridePctOi, overridePctLtCg, overridePctQdiv, overridePctTaxExempt,
    annualPropertyTax, propertyTaxGrowthRate, propertyTaxGrowthSource,
    effectiveAccountId, clientId, writer, showAssetMixTab, customAllocations, drivenByHoldings,
    currentSerialized, onAutoSaved, custodian, accountNumberLast4, isHsa, hsaCoverage,
    saveEquityAccount, activationEnabled, activationYear, activationYearRef,
  ]);

  useImperativeHandle(ref, () => ({ saveAsync: saveAsyncImpl }), [saveAsyncImpl]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (lockTab) return;

    // ── stock_options: bypass the generic accounts route ────────────────────
    if (category === "stock_options") {
      setLoading(true);
      setError(null);
      try {
        const result = await saveEquityAccount();
        if (!result.ok) {
          setError(result.error);
          return;
        }
        // Reset the dirty baseline so a still-mounted form doesn't fire a
        // redundant autosave on the next tab change (mirrors saveAsyncImpl).
        baselineRef.current = currentSerialized;
        router.refresh();
        onSuccess?.();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
      return;
    }

    setLoading(true);
    setError(null);

    const form = e.currentTarget;
    const data = new FormData(form);

    // Real estate persists the user's typed rate regardless of source, so
    // toggling Inflation ↔ Custom doesn't lose the value. The engine uses
    // `growthSource` to decide whether to substitute the resolved inflation
    // rate at projection time.
    let growthRate: string | null;
    if (category === "real_estate") {
      growthRate = String(Number(realEstateGrowthRatePct) / 100);
    } else if (growthSource === "custom") {
      growthRate = String(Number(data.get("growthRate")) / 100);
    } else {
      growthRate = isInvestable ? null : String(Number(data.get("growthRate")) / 100);
    }

    const toPctOrNull = (n: string) => {
      const v = data.get(n) as string;
      return v !== "" && v != null ? String(Number(v) / 100) : null;
    };

    const isMixedDeferralForBody =
      (data.get("category") as string) === "retirement" &&
      ((data.get("subType") as string) === "401k" ||
        (data.get("subType") as string) === "403b");
    const currentValue = data.get("value") as string;
    const accountBody = {
      name: data.get("name") as string,
      category: data.get("category") as string,
      subType: data.get("subType") as string,
      ...(parentBusinessId ? {} : { owners }),
      titlingType,
      parentAccountId: parentBusinessId,
      value: currentValue,
      // Cost basis is meaningless for 401k/403b; force 0 so any leftover
      // pre-migration value can't influence engine math.
      basis: isMixedDeferralForBody
        ? "0"
        : (data.get("basis") as string),
      rothValue: isMixedDeferralForBody
        ? ((data.get("rothValue") as string) || "0")
        : "0",
      growthRate,
      rmdEnabled,
      priorYearEndValue: rmdEnabled && priorYearEndValue !== "" ? priorYearEndValue : null,
      growthSource: isInvestable
        ? growthSource
        : category === "real_estate"
          ? realEstateGrowthSource
          : "custom",
      modelPortfolioId: growthSource === "model_portfolio" ? modelPortfolioId : null,
      tickerPortfolioId: growthSource === "ticker_portfolio" ? tickerPortfolioId : null,
      turnoverPct: toPctOrNull("turnoverPct") ?? "0",
      overridePctOi: toPctOrNull("overridePctOi"),
      overridePctLtCg: toPctOrNull("overridePctLtCg"),
      overridePctQdiv: toPctOrNull("overridePctQdiv"),
      overridePctTaxExempt: toPctOrNull("overridePctTaxExempt"),
      annualPropertyTax: category === "real_estate" ? annualPropertyTax : undefined,
      // Always persist the user's last custom rate, even when source=inflation
      // (the engine substitutes the inflation rate at projection time; this
      // value is then a fallback/display value preserved across toggles).
      propertyTaxGrowthRate:
        category === "real_estate"
          ? String(Number(propertyTaxGrowthRate) / 100)
          : undefined,
      propertyTaxGrowthSource: category === "real_estate" ? propertyTaxGrowthSource : undefined,
      custodian: custodian.trim() === "" ? null : custodian.trim(),
      accountNumberLast4: accountNumberLast4.trim() === "" ? null : accountNumberLast4.trim(),
      hsaCoverage: isHsa ? hsaCoverage : null,
      activationYear: activationEnabled ? activationYear : null,
      activationYearRef: activationEnabled ? activationYearRef : null,
    };

    try {
      const targetId = effectiveAccountId;
      if (targetId) {
        const res = await writer.submit(
          {
            op: "edit",
            targetKind: "account",
            targetId,
            desiredFields: accountBody,
          },
          {
            url: `/api/clients/${clientId}/accounts/${targetId}`,
            method: "PUT",
            body: accountBody,
          },
        );
        if (!res.ok) {
          const json = await res.json();
          throw new Error(json.error ?? "Failed to update account");
        }
        // Save asset mix allocations for existing account. Allocations are a
        // nested resource and not in v1 scenario scope — base mode only. Skipped
        // when holdings drive the account (the holdings sync owns the mix).
        if (showAssetMixTab && customAllocations.length > 0 && !writer.scenarioActive && !drivenByHoldings) {
          await fetch(`/api/clients/${clientId}/accounts/${targetId}/allocations`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ allocations: customAllocations }),
          });
        }
      } else {
        // Mint the new id up-front so we can pass it to the writer's `entity`
        // payload (the unified route requires `entity.id`) and still know what
        // it is for the allocations follow-up in base mode.
        const newAccountId =
          typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : `tmp-${Date.now()}`;
        const res = await writer.submit(
          {
            op: "add",
            targetKind: "account",
            entity: { id: newAccountId, ...accountBody },
          },
          {
            url: `/api/clients/${clientId}/accounts`,
            method: "POST",
            body: accountBody,
          },
        );
        if (!res.ok) {
          const json = await res.json();
          throw new Error(json.error ?? "Failed to create account");
        }
        // Base-mode response is the saved row (includes the server-assigned id);
        // scenario-mode response is `{ ok, targetId }`. Either way, the id we
        // need next is `account.id`.
        const account = writer.scenarioActive
          ? { id: newAccountId }
          : await res.json();

        // Save asset mix allocations for new account. Allocations are nested
        // and not in v1 scenario scope — base mode only. Skipped when holdings
        // drive the account (the holdings sync owns the mix).
        if (showAssetMixTab && customAllocations.length > 0 && !writer.scenarioActive && !drivenByHoldings) {
          await fetch(`/api/clients/${clientId}/accounts/${account.id}/allocations`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ allocations: customAllocations }),
          });
        }

        // Create savings rule if savings tab filled (create-only). Routes
        // through the writer so a savings_rule add fires through the unified
        // route in scenario mode (Task 14b).
        const savingsAmount = data.get("annualAmount") as string;
        const savingsPercent = data.get("annualPercent") as string;
        const hasAmount = contribMode === "amount" && savingsAmount && Number(savingsAmount) > 0;
        const hasPercent = contribMode === "percent" && savingsPercent && Number(savingsPercent) > 0;
        const hasMax = contribMode === "max";
        if (hasAmount || hasPercent || hasMax) {
          const matchPct = data.get("employerMatchPct") as string;
          const matchCap = data.get("employerMatchCap") as string;
          const matchAmount = data.get("employerMatchAmount") as string;
          const savingsGrowthRateDecimal =
            savingsGrowthSource === "custom"
              ? String(Number(savingsGrowthRateDisplay ?? "0") / 100)
              : String(resolvedInflationRate);
          const savingsBody = {
            accountId: account.id,
            annualAmount: hasAmount ? savingsAmount : "0",
            annualPercent: hasPercent ? String(Number(savingsPercent) / 100) : null,
            contributeMax: hasMax,
            isDeductible: showDeductibleCheckbox ? isDeductible : true,
            applyContributionLimit: showContributionCapCheckbox ? applyContributionLimit : true,
            startYear: String(savingsStartYear),
            endYear: String(savingsEndYear),
            startYearRef: savingsStartYearRef,
            endYearRef: savingsEndYearRef,
            growthRate: savingsGrowthRateDecimal,
            growthSource: savingsGrowthSource,
            employerMatchPct:
              showEmployerMatch && matchMode === "percent" && matchPct
                ? String(Number(matchPct) / 100)
                : null,
            employerMatchCap:
              showEmployerMatch && matchMode === "percent" && matchCap
                ? String(Number(matchCap) / 100)
                : null,
            employerMatchAmount:
              showEmployerMatch && matchMode === "flat" && matchAmount ? matchAmount : null,
          };

          const newSavingsRuleId =
            typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
              ? crypto.randomUUID()
              : `tmp-${Date.now()}`;
          const savingsRes = await writer.submit(
            {
              op: "add",
              targetKind: "savings_rule",
              entity: { id: newSavingsRuleId, ...savingsBody },
            },
            {
              url: `/api/clients/${clientId}/savings-rules`,
              method: "POST",
              body: savingsBody,
            },
          );
          if (!savingsRes.ok) {
            console.error("Failed to create savings rule");
          }
        }
      }

      router.refresh();
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  // ── In-form tab autosave ─────────────────────────────────────────────────────
  const accountAutoSave = useTabAutoSave({
    isDirty,
    canSave,
    saveAsync: saveAsyncImpl,
  });

  const handleTabClick = (next: typeof activeTab) => {
    // Holdings, Grants, and Beneficiaries are nested resources keyed by account
    // id, so the account must exist before those tabs are usable. When it
    // doesn't yet, force the tab-switch save to mint it (acts like clicking
    // Save) instead of showing a "save the account first" gate.
    const needsSavedAccount = RECORD_DEPENDENT_TABS.has(next) && !effectiveAccountId;
    void accountAutoSave.interceptTabChange(
      next,
      (id) => setActiveTab(id as typeof activeTab),
      { force: needsSavedAccount },
    );
  };

  return (
    <>
    <form id="add-account-form" onSubmit={handleSubmit} className="space-y-4">
      {/* Tab bar — pinned flush to the top of the dialog's scroll region. The
          dialog drops its body top-padding (bodyTopFlush) and we bleed full-width
          (-mx-6 px-6) so content scrolls cleanly behind the strip. */}
      <div className="sticky top-0 z-10 -mx-6 flex items-center border-b border-gray-700 bg-card px-6">
        <div className="flex flex-1">
          {!lockTab && (
            <button
              type="button"
              onClick={() => handleTabClick("details")}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
                activeTab === "details"
                  ? "border-accent text-accent"
                  : "border-transparent text-gray-300 hover:text-gray-200"
              }`}
            >
              Account Details
            </button>
          )}
          {!lockTab && category !== "real_estate" && category !== "business" && category !== "life_insurance" && category !== "notes_receivable" && category !== "stock_options" && (
            <button
              type="button"
              onClick={() => handleTabClick("savings")}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
                activeTab === "savings"
                  ? "border-accent text-accent"
                  : "border-transparent text-gray-300 hover:text-gray-200"
              }`}
            >
              Savings
            </button>
          )}
          {!lockTab && category === "taxable" && (
            <button
              type="button"
              onClick={() => handleTabClick("realization")}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
                activeTab === "realization"
                  ? "border-accent text-accent"
                  : "border-transparent text-gray-300 hover:text-gray-200"
              }`}
            >
              Realization
            </button>
          )}
          {!lockTab && showAssetMixTab && (
            <button
              type="button"
              onClick={() => handleTabClick("asset_mix")}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
                activeTab === "asset_mix"
                  ? "border-accent text-accent"
                  : "border-transparent text-gray-300 hover:text-gray-200"
              }`}
            >
              Asset Mix
            </button>
          )}
          {!lockTab && showAssetMixTab && (
            <button
              type="button"
              onClick={() => handleTabClick("holdings")}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
                activeTab === "holdings"
                  ? "border-accent text-accent"
                  : "border-transparent text-gray-300 hover:text-gray-200"
              }`}
            >
              Holdings
            </button>
          )}
          {!lockTab && showRmdCheckbox && (
            <button
              type="button"
              onClick={() => handleTabClick("rmd")}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
                activeTab === "rmd"
                  ? "border-accent text-accent"
                  : "border-transparent text-gray-300 hover:text-gray-200"
              }`}
            >
              RMD
            </button>
          )}
          {/* Grants tab — stock options only (Task 18) */}
          {!lockTab && category === "stock_options" && (
            <button
              type="button"
              onClick={() => handleTabClick("grants")}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
                activeTab === "grants"
                  ? "border-accent text-accent"
                  : "border-transparent text-gray-300 hover:text-gray-200"
              }`}
            >
              Grants
            </button>
          )}
          <button
            type="button"
            onClick={() => handleTabClick("beneficiaries")}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              activeTab === "beneficiaries"
                ? "border-accent text-accent"
                : "border-transparent text-gray-300 hover:text-gray-200"
            }`}
          >
            Beneficiaries
          </button>
        </div>
        <TabAutoSaveIndicator
          saving={accountAutoSave.saving}
          error={accountAutoSave.saveError}
          onDismissError={accountAutoSave.clearSaveError}
        />
      </div>

      {error && (
        <p className="rounded bg-red-900/50 px-3 py-2 text-sm text-red-400">{error}</p>
      )}

      {/* Account Details */}
      {!lockTab && (
      <div className={activeTab !== "details" ? "hidden" : ""}>
        <div className="space-y-4">
          <div>
            <label className={fieldLabelClassName} htmlFor="name">
              Account Name <span className="text-red-500">*</span>
            </label>
            <input
              ref={nameInputRef}
              id="name"
              name="name"
              type="text"
              required
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setUserEditedName(true);
              }}
              placeholder="e.g., Fidelity Brokerage"
              className={inputClassName}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            {!isSystemManagedCash && (
              <div>
                <label className={fieldLabelClassName} htmlFor="category">
                  Category <span className="text-red-500">*</span>
                </label>
                <select
                  id="category"
                  name="category"
                  required
                  value={category}
                  onChange={(e) => {
                    const newCat = e.target.value as AccountCategory;
                    setCategory(newCat);
                    const firstSub = SUB_TYPE_BY_CATEGORY[newCat][0];
                    setSubType(firstSub);
                    setRmdEnabled(isRmdEligibleSubType(firstSub));
                    if (!userEditedName) {
                      setName(uniqueAccountName(DEFAULT_NAME_BY_CATEGORY[newCat], existingNamesList));
                    }
                    // Savings tab is not available for real-estate, business, life_insurance,
                    // notes_receivable, or stock_options categories — snap back to Details if active.
                    if ((newCat === "real_estate" || newCat === "business" || newCat === "life_insurance" || newCat === "notes_receivable" || newCat === "stock_options") && (activeTab === "savings" || activeTab === "realization")) {
                      setActiveTab("details");
                    }
                  }}
                  className={selectClassName}
                >
                  {(Object.keys(CATEGORY_LABELS) as AccountCategory[])
                    .filter((cat) => cat !== "business" && cat !== "life_insurance" && cat !== "notes_receivable")
                    .map((cat) => (
                      <option key={cat} value={cat}>{CATEGORY_LABELS[cat]}</option>
                    ))}
                </select>
              </div>
            )}

            {!isSystemManagedCash && category !== "stock_options" && (
              <div>
                <label className={fieldLabelClassName} htmlFor="subType">
                  Account Type
                </label>
                <select
                  id="subType"
                  name="subType"
                  value={subType}
                  onChange={(e) => {
                    const newSub = e.target.value;
                    setSubType(newSub);
                    setRmdEnabled(isRmdEligibleSubType(newSub));
                    // Trad IRA default basis is 0 unless the advisor has
                    // already typed a value — flips back to mirroring on
                    // other subtypes.
                    if (!userEditedBasis) {
                      if (newSub === "traditional_ira") {
                        setAccountBasis("0");
                      } else {
                        setAccountBasis(accountValue);
                      }
                    }
                  }}
                  className={selectClassName}
                >
                  {subTypes.map((t) => (
                    <option key={t} value={t}>
                      {SUB_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="col-span-2">
              <OwnershipEditor
                familyMembers={familyMembers}
                entities={(entities ?? []).map((e) => ({ id: e.id, name: e.name }))}
                value={owners}
                onChange={setOwners}
                titlingType={titlingType}
                onTitlingTypeChange={setTitlingType}
                retirementMode={isRetirementSubType(subType) || category === "stock_options"}
                locked={isSystemManagedCash}
                lockedReason={
                  isSystemManagedCash
                    ? "This is a system-managed cash account — its ownership is fixed and can't be changed."
                    : undefined
                }
                businesses={isSystemManagedCash ? undefined : businesses}
                parentBusinessId={parentBusinessId}
                onParentBusinessIdChange={(next) => {
                  setParentBusinessId(next);
                  if (!next && owners.length === 0 && clientFm) {
                    setOwners([
                      { kind: "family_member", familyMemberId: clientFm.id, percent: 1 },
                    ]);
                  }
                }}
                childNoun="sub-asset"
              />
            </div>

            {!isSystemManagedCash && category !== "stock_options" && milestones && (
              <div className="col-span-2">
                <label className="flex items-center gap-2 text-sm text-ink-2">
                  <input
                    type="checkbox"
                    checked={activationEnabled}
                    onChange={(e) => setActivationEnabled(e.target.checked)}
                  />
                  <span>Activates in a future year (inheritance, new account)</span>
                </label>
                {activationEnabled && (
                  <div className="mt-2 max-w-xs">
                    <MilestoneYearPicker
                      id="activationYear"
                      name="activationYear"
                      label="Activates"
                      value={activationYear}
                      yearRef={activationYearRef}
                      milestones={milestones}
                      clientFirstName={clientFirstName}
                      spouseFirstName={spouseFirstName}
                      position="start"
                      minYear={currentYear}
                      onChange={(y, ref) => {
                        setActivationYear(y);
                        setActivationYearRef(ref);
                      }}
                    />
                    <p className="mt-1 text-[11px] text-ink-4">
                      The value above is the balance in this year; it grows from here.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* ── Stock Options equity fields — only visible for stock_options ── */}
            {category === "stock_options" && (
              <>
                {/* Row 1: Ticker + Public flag */}
                <div>
                  <label className={fieldLabelClassName} htmlFor="equity-ticker">
                    Ticker Symbol
                  </label>
                  <input
                    id="equity-ticker"
                    type="text"
                    value={ticker}
                    onChange={(e) => setTicker(e.target.value.toUpperCase())}
                    placeholder="e.g. AAPL"
                    className={inputClassName}
                  />
                </div>
                <div className="flex flex-col justify-end gap-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isPublic}
                      onChange={(e) => setIsPublic(e.target.checked)}
                      className="h-4 w-4 rounded border-gray-600 bg-gray-800 text-accent focus:ring-accent"
                    />
                    <span className={fieldLabelClassName}>Publicly traded</span>
                  </label>
                  {isPublic && (
                    <p className="text-xs text-gray-400">
                      Public ticker — price can be refreshed from market data (auto-refresh coming soon).
                    </p>
                  )}
                </div>

                {/* Row 2: Price per share */}
                <div>
                  <label className={fieldLabelClassName} htmlFor="equity-pricePerShare">
                    Price Per Share ($)
                  </label>
                  <CurrencyInput
                    id="equity-pricePerShare"
                    value={pricePerShare}
                    onChange={(raw) => setPricePerShare(raw)}
                    className={inputClassName}
                  />
                </div>

                {/* Row 3: Withholding rate */}
                <div>
                  <label className={fieldLabelClassName} htmlFor="equity-withholdingRate">
                    Withholding Rate (%)
                  </label>
                  <PercentInput
                    id="equity-withholdingRate"
                    value={withholdingRate}
                    onChange={(raw) => setWithholdingRate(raw)}
                    className={inputClassName}
                  />
                </div>

                {/* Row 4: Sell to cover + auto-create destination */}
                <div className="flex flex-col justify-end gap-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={sellToCover}
                      onChange={(e) => setSellToCover(e.target.checked)}
                      className="h-4 w-4 rounded border-gray-600 bg-gray-800 text-accent focus:ring-accent"
                    />
                    <span className={fieldLabelClassName}>Sell to cover taxes</span>
                  </label>
                </div>
                <div className="flex flex-col justify-end gap-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoCreateDestination}
                      onChange={(e) => setAutoCreateDestination(e.target.checked)}
                      className="h-4 w-4 rounded border-gray-600 bg-gray-800 text-accent focus:ring-accent"
                    />
                    <span className={fieldLabelClassName}>Auto-create destination account</span>
                  </label>
                </div>

                {/* Row 5: Default exercise timing */}
                <div className="col-span-2">
                  <label className={fieldLabelClassName} htmlFor="equity-defaultExerciseTiming">
                    Default Exercise Timing
                  </label>
                  <select
                    id="equity-defaultExerciseTiming"
                    value={defaultExerciseTiming}
                    onChange={(e) => setDefaultExerciseTiming(e.target.value)}
                    className={selectClassName}
                  >
                    <option value="at_vest">At vest</option>
                    <option value="specific_year">Specific year</option>
                    <option value="year_before_expiration">Year before expiration</option>
                    <option value="manual">Manual</option>
                  </select>
                  {defaultExerciseTiming === "specific_year" && (
                    <div className="mt-2">
                      <label className={fieldLabelClassName} htmlFor="equity-defaultExerciseYear">
                        Exercise Year
                      </label>
                      <input
                        id="equity-defaultExerciseYear"
                        type="number"
                        value={defaultExerciseYear}
                        onChange={(e) => setDefaultExerciseYear(e.target.value)}
                        placeholder={String(new Date().getFullYear())}
                        className={inputClassName}
                      />
                    </div>
                  )}
                </div>

                {/* Row 6: Default sell timing */}
                <div className="col-span-2">
                  <label className={fieldLabelClassName} htmlFor="equity-defaultSellTiming">
                    Default Sell Timing
                  </label>
                  <select
                    id="equity-defaultSellTiming"
                    value={defaultSellTiming}
                    onChange={(e) => setDefaultSellTiming(e.target.value)}
                    className={selectClassName}
                  >
                    <option value="immediately">Sell immediately</option>
                    <option value="hold_then_sell_year">Hold, then sell in year</option>
                    <option value="percent_per_year">Sell % per year</option>
                    <option value="hold">Hold</option>
                  </select>
                  {defaultSellTiming === "hold_then_sell_year" && (
                    <div className="mt-2">
                      <label className={fieldLabelClassName} htmlFor="equity-defaultSellYear">
                        Sell Year
                      </label>
                      <input
                        id="equity-defaultSellYear"
                        type="number"
                        value={defaultSellYear}
                        onChange={(e) => setDefaultSellYear(e.target.value)}
                        placeholder={String(new Date().getFullYear())}
                        className={inputClassName}
                      />
                    </div>
                  )}
                  {defaultSellTiming === "percent_per_year" && (
                    <div className="mt-2 grid grid-cols-2 gap-4">
                      <div>
                        <label className={fieldLabelClassName} htmlFor="equity-defaultSellPercentPerYear">
                          Sell % Per Year
                        </label>
                        <PercentInput
                          id="equity-defaultSellPercentPerYear"
                          value={defaultSellPercentPerYear}
                          onChange={(raw) => setDefaultSellPercentPerYear(raw)}
                          className={inputClassName}
                        />
                      </div>
                      <div>
                        <label className={fieldLabelClassName} htmlFor="equity-defaultSellStartYear">
                          Start Year
                        </label>
                        <input
                          id="equity-defaultSellStartYear"
                          type="number"
                          value={defaultSellStartYear}
                          onChange={(e) => setDefaultSellStartYear(e.target.value)}
                          placeholder={String(new Date().getFullYear())}
                          className={inputClassName}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}

            {category !== "stock_options" && (
            <div>
              <label className={fieldLabelClassName} htmlFor="value">
                Current Value ($)
              </label>
              <CurrencyInput
                id="value"
                name="value"
                value={drivenByHoldings ? holdingsTotals!.value : accountValue}
                disabled={drivenByHoldings}
                onChange={(raw) => {
                  setAccountValue(raw);
                  // Auto-mirror basis from value for plain non-retirement
                  // accounts. Traditional IRAs almost always have $0 after-
                  // tax basis (Form 8606 tracks contributions explicitly),
                  // so they default to 0 — advisor opts in to a non-zero
                  // basis on accounts with prior nondeductible contributions.
                  if (!userEditedBasis && subType !== "traditional_ira") {
                    setAccountBasis(raw);
                  }
                }}
                className={inputClassName}
              />
              {drivenByHoldings && (
                <p className="mt-1 text-xs text-gray-400">
                  Value &amp; cost basis are derived from this account&apos;s holdings.
                </p>
              )}
            </div>
            )}

            {category !== "stock_options" && (category === "retirement" && (subType === "401k" || subType === "403b") ? (
              <div>
                <label className={fieldLabelClassName} htmlFor="rothValue">
                  Roth Value ($)
                </label>
                <CurrencyInput
                  id="rothValue"
                  name="rothValue"
                  value={accountRothValue}
                  onChange={(raw) => setAccountRothValue(raw)}
                  className={inputClassName}
                />
                <p className="mt-1 text-xs text-gray-400">
                  Portion of the balance designated as Roth. Grows with the
                  account and is excluded from tax on withdrawal.
                </p>
              </div>
            ) : (
              <div>
                <label className={fieldLabelClassName} htmlFor="basis">
                  Cost Basis ($)
                </label>
                <CurrencyInput
                  id="basis"
                  name="basis"
                  value={drivenByHoldings ? holdingsTotals!.basis : accountBasis}
                  disabled={drivenByHoldings}
                  onChange={(raw) => {
                    setAccountBasis(raw);
                    setUserEditedBasis(true);
                  }}
                  className={inputClassName}
                />
              </div>
            ))}

            {category !== "stock_options" && <div className={`col-span-2 grid gap-4 ${category === "real_estate" ? "grid-cols-3" : "grid-cols-2"}`}>
              {isInvestable ? (
                <GrowthRateField
                  category={category}
                  growthSource={growthSource}
                  modelPortfolioId={modelPortfolioId}
                  tickerPortfolioId={tickerPortfolioId}
                  growthRatePct={growthRatePct}
                  modelPortfolios={modelPortfolios}
                  fundPortfolios={fundPortfolios}
                  defaultPctForCategory={defaultPctForCategory}
                  catDefaultPortfolioName={catDefaultSource?.portfolioName ?? null}
                  resolvedInflationRate={resolvedInflationRate}
                  assetMixBlendedPct={assetMixBlendedPct}
                  customPlaceholder={String(hasExplicitGrowth ? initialGrowthPct : 7)}
                  onSourceChange={handleGrowthSourceChange}
                  onCustomPctChange={(raw) => setGrowthRatePct(raw)}
                />
              ) : category === "real_estate" ? (
                <div>
                  <label className={fieldLabelClassName}>Growth Rate</label>
                  <select
                    value={realEstateGrowthSource}
                    onChange={(e) => setRealEstateGrowthSource(e.target.value as "custom" | "inflation")}
                    className={selectClassName}
                  >
                    <option value="custom">Custom %</option>
                    <option value="inflation">
                      {(resolvedInflationRate * 100).toFixed(2)}% — Inflation rate
                    </option>
                  </select>
                  {realEstateGrowthSource === "custom" && (
                    <div className="mt-2">
                      <PercentInput
                        id="growthRate"
                        value={realEstateGrowthRatePct}
                        onChange={(raw) => setRealEstateGrowthRatePct(raw)}
                        className={inputClassName}
                      />
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <label className={fieldLabelClassName} htmlFor="growthRate">
                    Growth Rate (%)
                  </label>
                  <PercentInput
                    id="growthRate"
                    name="growthRate"
                    value={growthRatePct}
                    onChange={(raw) => setGrowthRatePct(raw)}
                    className={inputClassName}
                  />
                </div>
              )}

              {category === "real_estate" && (
                <>
                  <div>
                    <label className={fieldLabelClassName} htmlFor="annualPropertyTax">
                      Annual Property Tax
                    </label>
                    <CurrencyInput
                      id="annualPropertyTax"
                      value={annualPropertyTax}
                      onChange={(raw) => setAnnualPropertyTax(raw)}
                      className={inputClassName}
                    />
                  </div>
                  <div>
                    <label className={fieldLabelClassName}>Property Tax Growth</label>
                    <select
                      value={propertyTaxGrowthSource}
                      onChange={(e) => setPropertyTaxGrowthSource(e.target.value as "custom" | "inflation")}
                      className={selectClassName}
                    >
                      <option value="custom">Custom %</option>
                      <option value="inflation">
                        {(resolvedInflationRate * 100).toFixed(2)}% — Inflation rate
                      </option>
                    </select>
                    {propertyTaxGrowthSource === "custom" && (
                      <div className="mt-2">
                        <PercentInput
                          id="propertyTaxGrowthRate"
                          value={propertyTaxGrowthRate}
                          onChange={(raw) => setPropertyTaxGrowthRate(raw)}
                          className={inputClassName}
                        />
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>}

            {isHsa && (
              <div className="col-span-2">
                <label className={fieldLabelClassName} htmlFor="hsa-coverage">
                  HSA Coverage
                </label>
                <select
                  id="hsa-coverage"
                  value={hsaCoverage}
                  onChange={(e) => setHsaCoverage(e.target.value as "self" | "family")}
                  className={selectClassName}
                >
                  <option value="self">Self-only</option>
                  <option value="family">Family</option>
                </select>
                <p className="mt-1 text-xs text-gray-400">
                  Sets the annual contribution limit. Catch-up (+$1,000) applies automatically at 55+.
                </p>
              </div>
            )}

            <details className="col-span-2 mt-2 rounded-[var(--radius-sm)] border border-hair bg-card-2/40">
              <summary className="cursor-pointer select-none px-3 py-2 text-[13px] text-ink-3 hover:text-ink">
                Account identification
              </summary>
              <div className="grid grid-cols-2 gap-4 px-3 pb-3 pt-1">
                <div>
                  <label className={fieldLabelClassName} htmlFor="custodian">Custodian</label>
                  <input
                    id="custodian"
                    type="text"
                    value={custodian}
                    onChange={(e) => setCustodian(e.target.value)}
                    placeholder="e.g. Fidelity"
                    className={inputClassName}
                  />
                </div>
                <div>
                  <label className={fieldLabelClassName} htmlFor="accountNumberLast4">Acct # (last 4)</label>
                  <input
                    id="accountNumberLast4"
                    type="text"
                    inputMode="numeric"
                    maxLength={4}
                    value={accountNumberLast4}
                    onChange={(e) => setAccountNumberLast4(e.target.value)}
                    placeholder="Last 4"
                    className={inputClassName}
                  />
                </div>
              </div>
            </details>
          </div>
        </div>
      </div>
      )}

      {/* Savings tab — edit mode shows rule list; create mode shows inline form */}
      {!lockTab && (
      <div className={activeTab === "savings" ? "" : "hidden"}>
      {isEdit ? (
        <div className="space-y-3">
          <SavingsRulesList
            rules={accountSavingsRules}
            showAccountColumn={false}
            onEdit={(rule) => { setSrDialogEditing(rule); setSrDialogOpen(true); }}
            onDelete={(rule) => setDeletingSr(rule)}
            onAdd={() => { setSrDialogEditing(undefined); setSrDialogOpen(true); }}
          />
        </div>
      ) : (
      <div className="">
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-4">
              <div className="col-span-2">
                <ContributionAmountFields
                  mode={contribMode}
                  onModeChange={setContribMode}
                  showModeToggle={showContributionModeToggle}
                  showMaxToggle={showContributionMaxToggle}
                  initialAmount={0}
                  idPrefix="acct-sr"
                />
              </div>

              {milestones ? (
                <MilestoneYearPicker
                  name="savingsStartYear"
                  id="savingsStartYear"
                  value={savingsStartYear}
                  yearRef={savingsStartYearRef}
                  milestones={milestones}
                  onChange={(yr, ref) => {
                    setSavingsStartYear(yr);
                    setSavingsStartYearRef(ref);
                  }}
                  label="Start Year"
                  clientFirstName={clientFirstName}
                  spouseFirstName={spouseFirstName}
                  position="start"
                />
              ) : (
                <div>
                  <label className={fieldLabelClassName} htmlFor="savingsStartYear">
                    Start Year
                  </label>
                  <input
                    id="savingsStartYear"
                    name="savingsStartYear"
                    type="number"
                    value={savingsStartYear}
                    onChange={(e) => {
                      setSavingsStartYear(Number(e.target.value));
                      setSavingsStartYearRef(null);
                    }}
                    className={inputClassName}
                  />
                </div>
              )}

              {milestones ? (
                <MilestoneYearPicker
                  name="savingsEndYear"
                  id="savingsEndYear"
                  value={savingsEndYear}
                  yearRef={savingsEndYearRef}
                  milestones={milestones}
                  onChange={(yr, ref) => {
                    setSavingsEndYear(yr);
                    setSavingsEndYearRef(ref);
                  }}
                  label="End Year"
                  clientFirstName={clientFirstName}
                  spouseFirstName={spouseFirstName}
                  startYearForDuration={savingsStartYear}
                  position="end"
                />
              ) : (
                <div>
                  <label className={fieldLabelClassName} htmlFor="savingsEndYear">
                    End Year
                  </label>
                  <input
                    id="savingsEndYear"
                    name="savingsEndYear"
                    type="number"
                    value={savingsEndYear}
                    onChange={(e) => {
                      setSavingsEndYear(Number(e.target.value));
                      setSavingsEndYearRef(null);
                    }}
                    className={inputClassName}
                  />
                </div>
              )}

            </div>

            {/* Growth has no effect in percent-of-salary mode — the
                contribution is recomputed from each year's salary. */}
            {contribMode !== "percent" && (
              <div>
                <label className={fieldLabelClassName}>Growth</label>
                <div className="mt-1">
                  <GrowthSourceRadio
                    value={savingsGrowthSource}
                    customRate={savingsGrowthRateDisplay}
                    resolvedInflationRate={resolvedInflationRate}
                    onChange={(next) => {
                      setSavingsGrowthSource(next.value);
                      setSavingsGrowthRateDisplay(next.customRate);
                    }}
                  />
                </div>
              </div>
            )}

            {showDeductibleCheckbox && (
              <DeductibleContributionCheckbox
                checked={isDeductible}
                onChange={setIsDeductible}
                idPrefix="acct-sr"
              />
            )}

            {showContributionCapCheckbox && (
              <ContributionCapCheckbox
                checked={applyContributionLimit}
                onChange={setApplyContributionLimit}
                idPrefix="acct-sr"
              />
            )}

            {showEmployerMatch && (
              <EmployerMatchFields
                mode={matchMode}
                onModeChange={setMatchMode}
                idPrefix="acct-sr"
              />
            )}
          </div>
        </div>
      )}
      </div>


      )}

      {/* Realization tab — taxable and retirement accounts */}
      {!lockTab && category === "taxable" && (
        <div className={activeTab === "realization" ? "" : "hidden"}>
          <div className="space-y-4">
            <p className="text-xs text-gray-400">
              How growth is realized for tax purposes. Leave blank to inherit from the model portfolio.
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={fieldLabelClassName}>Ordinary Income %</label>
                <PercentInput name="overridePctOi"
                  value={overridePctOi}
                  onChange={(raw) => setOverridePctOi(raw)}
                  placeholder="From portfolio"
                  className={inputClassName} />
              </div>
              <div>
                <label className={fieldLabelClassName}>LT Capital Gains %</label>
                <PercentInput name="overridePctLtCg"
                  value={overridePctLtCg}
                  onChange={(raw) => setOverridePctLtCg(raw)}
                  placeholder="From portfolio"
                  className={inputClassName} />
              </div>
              <div>
                <label className={fieldLabelClassName}>Qualified Dividends %</label>
                <PercentInput name="overridePctQdiv"
                  value={overridePctQdiv}
                  onChange={(raw) => setOverridePctQdiv(raw)}
                  placeholder="From portfolio"
                  className={inputClassName} />
              </div>
              <div>
                <label className={fieldLabelClassName}>Tax-Exempt %</label>
                <PercentInput name="overridePctTaxExempt"
                  value={overridePctTaxExempt}
                  onChange={(raw) => setOverridePctTaxExempt(raw)}
                  placeholder="From portfolio"
                  className={inputClassName} />
              </div>
              <div>
                <label className={fieldLabelClassName}>Turnover %</label>
                <PercentInput name="turnoverPct"
                  value={turnoverPct}
                  onChange={(raw) => setTurnoverPct(raw)}
                  className={inputClassName} />
                <p className="mt-1 text-xs text-gray-400">Portion of LT CG realized as short-term each year.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Asset Mix tab */}
      {!lockTab && showAssetMixTab && assetClasses && (
        <div className={activeTab === "asset_mix" ? "" : "hidden"}>
          <AssetMixTab
            assetClasses={assetClasses}
            inheritedPortfolioName={
              growthSource === "model_portfolio" && modelPortfolioId
                ? modelPortfolios?.find((mp) => mp.id === modelPortfolioId)?.name
                : growthSource === "ticker_portfolio" && tickerPortfolioId
                  ? fundPortfolios?.find((fp) => fp.id === tickerPortfolioId)?.name
                  : growthSource === "default" && catDefaultSource?.portfolioName
                    ? catDefaultSource.portfolioName
                    : undefined
            }
            allocations={customAllocations}
            onChange={setCustomAllocations}
            derivedFromHoldings={drivenByHoldings}
          />
        </div>
      )}

      {!lockTab && showAssetMixTab && assetClasses && (
        <div className={activeTab === "holdings" ? "" : "hidden"}>
          <HoldingsTab
            clientId={clientId}
            accountId={effectiveAccountId}
            scenarioActive={writer.scenarioActive}
            assetClasses={assetClasses}
            deriveFromHoldings={deriveFromHoldings}
            onDeriveFromHoldingsChange={setDeriveFromHoldings}
            onTotalsChange={setHoldingsTotals}
            onHoldingsChanged={refreshAllocationsFromServer}
          />
        </div>
      )}

      {/* RMD tab — only present when subType is RMD-eligible */}
      {!lockTab && showRmdCheckbox && (
        <div className={activeTab === "rmd" ? "" : "hidden"}>
          <div className="space-y-4">
            <div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={rmdEnabled}
                  onChange={(e) => setRmdEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-600 bg-gray-800 text-accent focus:ring-accent"
                />
                <span className="text-sm font-medium text-gray-300">Subject to RMDs</span>
              </label>
              <p className="mt-1 ml-6 text-xs text-gray-400">
                Required Minimum Distributions apply to pre-tax retirement accounts starting at age 73 or 75.
              </p>
            </div>

            {rmdEnabled && (
              <div>
                <label className={fieldLabelClassName} htmlFor="priorYearEndValue">
                  Prior Dec 31 Balance
                </label>
                <CurrencyInput
                  id="priorYearEndValue"
                  value={priorYearEndValue}
                  onChange={(raw) => setPriorYearEndValue(raw)}
                  className={inputClassName}
                  placeholder="Leave blank to use current value"
                />
                <p className="mt-1 text-xs text-gray-400">
                  IRS RMDs are calculated off the prior calendar year-end balance. If
                  the account value above isn&apos;t a true Dec 31 snapshot, set this to
                  align the first projection year&apos;s RMD with the custodian&apos;s
                  letter. Ignored after Year 1 — later years use the engine&apos;s own
                  year-end balances.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Grants tab — stock options only (Task 18) */}
      {!lockTab && category === "stock_options" && (
        <div className={activeTab === "grants" ? "" : "hidden"}>
          <GrantsTab clientId={clientId} accountId={effectiveAccountId} />
        </div>
      )}

      {/* Beneficiaries tab — keyed on the effective (post-autosave) account id so
          it's usable the moment switching to it force-creates the account. */}
      <div className={activeTab === "beneficiaries" ? "" : "hidden"}>
        {!effectiveAccountId ? (
          <p className="text-sm text-gray-300">Save the account first, then designate beneficiaries.</p>
        ) : (
          <BeneficiariesTab clientId={clientId} accountId={effectiveAccountId} active={activeTab === "beneficiaries"} />
        )}
      </div>

    </form>

    {isEdit && srDialogOpen && (
      <SavingsRuleDialog
        clientId={clientId}
        accounts={[{ id: initial!.id, name: initial!.name, category: initial!.category, subType: initial!.subType }]}
        open={srDialogOpen}
        onOpenChange={(o) => { setSrDialogOpen(o); if (!o) setSrDialogEditing(undefined); }}
        editing={srDialogEditing}
        onSaved={(rule, mode) => {
          if (mode === "create") setAccountSavingsRules((prev) => [...prev, rule]);
          else setAccountSavingsRules((prev) => prev.map((r) => (r.id === rule.id ? rule : r)));
        }}
        onRequestDelete={() => { if (srDialogEditing) setDeletingSr(srDialogEditing); setSrDialogOpen(false); }}
        clientInfo={milestones ? { milestones } : undefined}
        ownerNames={ownerNames ? { clientName: ownerNames.clientName, spouseName: ownerNames.spouseName } : undefined}
        resolvedInflationRate={resolvedInflationRate}
      />
    )}

    {deletingSr && (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <div className="absolute inset-0 bg-black/70" onClick={() => setDeletingSr(null)} />
        <div className="relative z-10 w-full max-w-sm rounded-lg border-2 border-ink-3 ring-1 ring-black/60 bg-gray-900 p-6 shadow-xl">
          <h3 className="mb-2 text-base font-semibold text-gray-100">Delete Savings Rule</h3>
          <p className="mb-4 text-sm text-gray-300">Remove this savings rule? This cannot be undone.</p>
          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => setDeletingSr(null)} className="rounded-md border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800">Cancel</button>
            <button
              type="button"
              onClick={async () => {
                const res = await writer.submit(
                  { op: "remove", targetKind: "savings_rule", targetId: deletingSr.id },
                  {
                    url: `/api/clients/${clientId}/savings-rules/${deletingSr.id}`,
                    method: "DELETE",
                  },
                );
                if (res.ok || res.status === 204) {
                  setAccountSavingsRules((prev) => prev.filter((r) => r.id !== deletingSr.id));
                }
                setDeletingSr(null);
              }}
              className="rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800"
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
});

export default AddAccountForm;
