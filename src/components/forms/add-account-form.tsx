"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useScenarioWriter } from "@/hooks/use-scenario-writer";
import { AssetMixTab, type AssetClassOption } from "./asset-mix-tab";
import BeneficiariesTab from "./beneficiaries-tab";
import { CurrencyInput } from "@/components/currency-input";
import { PercentInput } from "@/components/percent-input";
import MilestoneYearPicker from "@/components/milestone-year-picker";
import type { YearRef, ClientMilestones } from "@/lib/milestones";
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
import { OwnershipEditor } from "./ownership-editor";
import type { AccountOwner } from "@/engine/ownership";
import { RETIREMENT_SUBTYPES } from "@/lib/ownership";

const isRetirementSubType = (st: string) =>
  (RETIREMENT_SUBTYPES as readonly string[]).includes(st);

type AccountCategory = "taxable" | "cash" | "retirement" | "real_estate" | "business" | "life_insurance";

export interface AccountFormInitial {
  id: string;
  name: string;
  category: AccountCategory;
  subType: string;
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
  annualPropertyTax?: string;
  propertyTaxGrowthRate?: string;
  propertyTaxGrowthSource?: string;
  growthSource?: string;
  modelPortfolioId?: string | null;
  turnoverPct?: string;
  overridePctOi?: string | null;
  overridePctLtCg?: string | null;
  overridePctQdiv?: string | null;
  overridePctTaxExempt?: string | null;
  /** When true, the account is the auto-provisioned household cash account
   * and cannot be deleted (the projection engine uses it as the default
   * deposit/expense target). */
  isDefaultChecking?: boolean;
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
  real_estate: string;
  business: string;
  life_insurance: string;
}

interface AddAccountFormProps {
  clientId: string;
  category?: AccountCategory;
  mode?: "create" | "edit";
  initial?: AccountFormInitial;
  entities?: EntityOption[];
  familyMembers?: { id: string; role: "client" | "spouse" | "child" | "other"; firstName: string }[];
  categoryDefaults?: CategoryDefaults;
  /** Real names used in the owner dropdown. Falls back to "Client"/"Spouse" if absent. */
  ownerNames?: { clientName: string; spouseName: string | null };
  modelPortfolios?: ModelPortfolioOption[];
  assetClasses?: AssetClassOption[];
  portfolioAllocationsMap?: Record<string, { assetClassId: string; weight: number }[]>;
  categoryDefaultSources?: Record<string, { source: string; portfolioId?: string; portfolioName?: string; blendedReturn?: number }>;
  milestones?: ClientMilestones;
  clientFirstName?: string;
  spouseFirstName?: string;
  /** Existing account names for auto-increment default naming on create. */
  existingAccountNames?: string[];
  resolvedInflationRate?: number;
  initialTab?: "details" | "savings" | "realization" | "asset_mix" | "rmd" | "beneficiaries";
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
}

const SUB_TYPE_BY_CATEGORY: Record<AccountCategory, string[]> = {
  taxable: ["brokerage", "trust", "other"],
  cash: ["savings", "checking", "other"],
  retirement: ["traditional_ira", "roth_ira", "401k", "403b", "529", "other"],
  real_estate: ["primary_residence", "rental_property", "commercial_property"],
  business: ["sole_proprietorship", "partnership", "s_corp", "c_corp", "llc"],
  life_insurance: ["term", "whole_life", "universal_life", "variable_life"],
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
  real_estate: "Real Estate",
  business: "Business",
  life_insurance: "Life Insurance",
};

const RETIREMENT_SUB_TYPES = new Set(["traditional_ira", "roth_ira", "401k", "403b", "529"]);
const RMD_ELIGIBLE_SUB_TYPES = new Set(["traditional_ira", "401k", "403b"]);

const DEFAULT_NAME_BY_CATEGORY: Record<AccountCategory, string> = {
  taxable: "Taxable Account",
  cash: "Cash Account",
  retirement: "Retirement Account",
  real_estate: "Real Estate",
  business: "Business Interest",
  life_insurance: "Life Insurance Policy",
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

export default function AddAccountForm({
  clientId,
  category: defaultCategory,
  mode = "create",
  initial,
  entities,
  familyMembers = [],
  categoryDefaults,
  ownerNames,
  modelPortfolios,
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
}: AddAccountFormProps) {
  const router = useRouter();
  const writer = useScenarioWriter(clientId);
  const isEdit = mode === "edit" && !!initial;

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
    initial?.value != null ? String(initial.value) : "",
  );
  const [accountBasis, setAccountBasis] = useState<string>(
    initial?.basis != null ? String(initial.basis) : "",
  );
  const [userEditedBasis, setUserEditedBasis] = useState<boolean>(mode === "edit");
  // 401k/403b only — Roth-designated portion of value. Defaults to 0
  // (regular pre-tax 401k) and is independent from the basis field.
  const [accountRothValue, setAccountRothValue] = useState<string>(
    initial?.rothValue != null ? String(initial.rothValue) : "",
  );
  const [activeTab, setActiveTab] = useState<"details" | "savings" | "realization" | "asset_mix" | "rmd" | "beneficiaries">(
    initialTab ?? "details",
  );
  const [subType, setSubType] = useState(
    initial?.subType ?? SUB_TYPE_BY_CATEGORY[defaultCategory ?? "taxable"][0]
  );
  const [rmdEnabled, setRmdEnabled] = useState<boolean>(
    initial?.rmdEnabled ?? RMD_ELIGIBLE_SUB_TYPES.has(
      initial?.subType ?? SUB_TYPE_BY_CATEGORY[defaultCategory ?? "taxable"][0]
    )
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

  // Growth source: "default" (category default), "model_portfolio", or "custom"
  const isInvestable = ["taxable", "cash", "retirement"].includes(category);
  const [growthSource, setGrowthSource] = useState<"default" | "model_portfolio" | "custom" | "asset_mix" | "inflation">(
    (initial?.growthSource as "default" | "model_portfolio" | "custom" | "asset_mix" | "inflation") ?? "default"
  );
  // Real estate uses its own source toggle (custom vs. plan inflation). Stored
  // in the same `growth_source` column on save.
  const [realEstateGrowthSource, setRealEstateGrowthSource] = useState<"custom" | "inflation">(
    initial?.category === "real_estate" && initial?.growthSource === "inflation" ? "inflation" : "custom",
  );
  const [modelPortfolioId, setModelPortfolioId] = useState<string>(
    initial?.modelPortfolioId ?? ""
  );
  const [customAllocations, setCustomAllocations] = useState<{ assetClassId: string; weight: number }[]>([]);
  const [allocationsLoaded, setAllocationsLoaded] = useState(false);
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

  const ASSET_MIX_CATEGORIES = ["taxable", "retirement"];
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
  const hasExplicitGrowth = initial?.growthRate != null && initial.growthRate !== "";
  const useDefaultGrowth = growthSource === "default";
  const defaultPctForCategory = catDefaultSource?.blendedReturn != null
    ? Math.round(catDefaultSource.blendedReturn * 10000) / 100
    : categoryDefaults
      ? Math.round(Number(categoryDefaults[category]) * 10000) / 100
      : null;

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
  const [savingsGrowthSource, setSavingsGrowthSource] = useState<"custom" | "inflation">("custom");
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
    if (v.startsWith("mp:")) {
      const newId = v.slice(3);
      setGrowthSource("model_portfolio");
      setModelPortfolioId(newId);
      // Pre-fill allocations from the selected model portfolio
      const portfolioAllocs = portfolioAllocationsMap?.[newId] ?? [];
      if (portfolioAllocs.length > 0) setCustomAllocations(portfolioAllocs);
    } else if (v === "asset_mix") {
      setGrowthSource("asset_mix");
      setModelPortfolioId("");
    } else if (v === "inflation") {
      setGrowthSource("inflation");
      setModelPortfolioId("");
    } else if (v === "custom") {
      setGrowthSource("custom");
      setModelPortfolioId("");
    } else {
      setGrowthSource("default");
      setModelPortfolioId("");
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (lockTab) return;
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

    const toPctOrNull = (name: string) => {
      const v = data.get(name) as string;
      return v !== "" && v != null ? String(Number(v) / 100) : null;
    };

    const isMixedDeferralForBody =
      (data.get("category") as string) === "retirement" &&
      ((data.get("subType") as string) === "401k" ||
        (data.get("subType") as string) === "403b");
    const accountBody = {
      name: data.get("name") as string,
      category: data.get("category") as string,
      subType: data.get("subType") as string,
      owners,
      value: data.get("value") as string,
      // Cost basis is meaningless for 401k/403b; force 0 so any leftover
      // pre-migration value can't influence engine math.
      basis: isMixedDeferralForBody ? "0" : (data.get("basis") as string),
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
    };

    try {
      if (isEdit) {
        const res = await writer.submit(
          {
            op: "edit",
            targetKind: "account",
            targetId: initial!.id,
            desiredFields: accountBody,
          },
          {
            url: `/api/clients/${clientId}/accounts/${initial!.id}`,
            method: "PUT",
            body: accountBody,
          },
        );
        if (!res.ok) {
          const json = await res.json();
          throw new Error(json.error ?? "Failed to update account");
        }
        // Save asset mix allocations for existing account. Allocations are a
        // nested resource and not in v1 scenario scope — base mode only.
        if (showAssetMixTab && customAllocations.length > 0 && !writer.scenarioActive) {
          await fetch(`/api/clients/${clientId}/accounts/${initial!.id}/allocations`, {
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
        // and not in v1 scenario scope — base mode only.
        if (showAssetMixTab && customAllocations.length > 0 && !writer.scenarioActive) {
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

  return (
    <>
    <form id="add-account-form" onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <p className="rounded bg-red-900/50 px-3 py-2 text-sm text-red-400">{error}</p>
      )}

      {/* Tab bar */}
      <div className="flex border-b border-gray-700">
        {!lockTab && (
          <button
            type="button"
            onClick={() => setActiveTab("details")}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              activeTab === "details"
                ? "border-accent text-accent"
                : "border-transparent text-gray-300 hover:text-gray-200"
            }`}
          >
            Account Details
          </button>
        )}
        {!lockTab && category !== "real_estate" && category !== "business" && category !== "life_insurance" && (
          <button
            type="button"
            onClick={() => setActiveTab("savings")}
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
            onClick={() => setActiveTab("realization")}
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
            onClick={() => setActiveTab("asset_mix")}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              activeTab === "asset_mix"
                ? "border-accent text-accent"
                : "border-transparent text-gray-300 hover:text-gray-200"
            }`}
          >
            Asset Mix
          </button>
        )}
        {!lockTab && showRmdCheckbox && (
          <button
            type="button"
            onClick={() => setActiveTab("rmd")}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              activeTab === "rmd"
                ? "border-accent text-accent"
                : "border-transparent text-gray-300 hover:text-gray-200"
            }`}
          >
            RMD
          </button>
        )}
        <button
          type="button"
          onClick={() => setActiveTab("beneficiaries")}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
            activeTab === "beneficiaries"
              ? "border-accent text-accent"
              : "border-transparent text-gray-300 hover:text-gray-200"
          }`}
        >
          Beneficiaries
        </button>
      </div>

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
                  setRmdEnabled(RMD_ELIGIBLE_SUB_TYPES.has(firstSub));
                  if (!userEditedName) {
                    setName(uniqueAccountName(DEFAULT_NAME_BY_CATEGORY[newCat], existingNamesList));
                  }
                  // Savings tab is not available for real-estate, business, or life_insurance
                  // categories — snap back to Details if it was active.
                  if ((newCat === "real_estate" || newCat === "business" || newCat === "life_insurance") && activeTab === "savings") {
                    setActiveTab("details");
                  }
                }}
                className={selectClassName}
              >
                {(Object.keys(CATEGORY_LABELS) as AccountCategory[]).map((cat) => (
                  <option key={cat} value={cat}>{CATEGORY_LABELS[cat]}</option>
                ))}
              </select>
            </div>

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
                  setRmdEnabled(RMD_ELIGIBLE_SUB_TYPES.has(newSub));
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

            <div className="col-span-2">
              <OwnershipEditor
                familyMembers={familyMembers}
                entities={(entities ?? []).map((e) => ({ id: e.id, name: e.name }))}
                value={owners}
                onChange={setOwners}
                retirementMode={isRetirementSubType(subType)}
              />
            </div>

            <div>
              <label className={fieldLabelClassName} htmlFor="value">
                Current Value ($)
              </label>
              <CurrencyInput
                id="value"
                name="value"
                value={accountValue}
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
            </div>

            {category === "retirement" && (subType === "401k" || subType === "403b") ? (
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
                  value={accountBasis}
                  onChange={(raw) => {
                    setAccountBasis(raw);
                    setUserEditedBasis(true);
                  }}
                  className={inputClassName}
                />
              </div>
            )}

            <div className={`col-span-2 grid gap-4 ${category === "real_estate" ? "grid-cols-3" : "grid-cols-2"}`}>
              {isInvestable ? (
                <div>
                  <label className={fieldLabelClassName}>Growth Rate</label>
                  <select
                    value={growthSource === "model_portfolio" ? `mp:${modelPortfolioId}` : growthSource}
                    onChange={(e) => handleGrowthSourceChange(e.target.value)}
                    className={selectClassName}
                  >
                    <option value="default">
                      {defaultPctForCategory !== null ? `${defaultPctForCategory}% — ` : ""}{catDefaultSource?.portfolioName ?? "Category default"} (default)
                    </option>
                    {modelPortfolios?.map((mp) => (
                      <option key={mp.id} value={`mp:${mp.id}`}>
                        {(mp.blendedReturn * 100).toFixed(2)}% — {mp.name}
                      </option>
                    ))}
                    {ASSET_MIX_CATEGORIES.includes(category) && (
                      <option value="asset_mix">Asset mix (custom)</option>
                    )}
                    {(category === "cash" || category === "taxable" || category === "retirement") && (
                      <option value="inflation">
                        {(resolvedInflationRate * 100).toFixed(2)}% — Inflation rate
                      </option>
                    )}
                    <option value="custom">Custom %</option>
                  </select>
                  {growthSource === "inflation" && (
                    <p className="mt-1 text-xs text-gray-400">
                      Growth tracks plan inflation rate: {(resolvedInflationRate * 100).toFixed(2)}%
                    </p>
                  )}
                  {growthSource === "custom" && (
                    <div className="mt-2">
                      <PercentInput
                        id="growthRate"
                        name="growthRate"
                        value={growthRatePct}
                        onChange={(raw) => setGrowthRatePct(raw)}
                        placeholder={String(hasExplicitGrowth ? initialGrowthPct : 7)}
                        className={inputClassName}
                      />
                    </div>
                  )}
                </div>
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
            </div>
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
            <div className="grid grid-cols-2 gap-4">
              <div>
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

              {/* Growth has no effect in percent-of-salary mode — the
                  contribution is recomputed from each year's salary. */}
              {contribMode !== "percent" && (
                <div className="col-span-2">
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
            </div>

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
                : growthSource === "default" && catDefaultSource?.portfolioName
                  ? catDefaultSource.portfolioName
                  : undefined
            }
            allocations={customAllocations}
            onChange={setCustomAllocations}
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

      {/* Beneficiaries tab */}
      <div className={activeTab === "beneficiaries" ? "" : "hidden"}>
        {mode === "create" || !initial?.id ? (
          <p className="text-sm text-gray-300">Save the account first, then designate beneficiaries.</p>
        ) : (
          <BeneficiariesTab clientId={clientId} accountId={initial.id} active={activeTab === "beneficiaries"} />
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
}
