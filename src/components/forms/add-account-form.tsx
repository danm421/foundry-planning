"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { AssetMixTab, type AssetClassOption } from "./asset-mix-tab";
import { CurrencyInput } from "@/components/currency-input";
import { PercentInput } from "@/components/percent-input";
import MilestoneYearPicker from "@/components/milestone-year-picker";
import type { YearRef, ClientMilestones } from "@/lib/milestones";

type AccountCategory = "taxable" | "cash" | "retirement" | "real_estate" | "business" | "life_insurance";

export interface AccountFormInitial {
  id: string;
  name: string;
  category: AccountCategory;
  subType: string;
  owner: string;
  value: string;
  basis: string;
  // null means "use the default for this category" from plan_settings
  growthRate: string | null;
  rmdEnabled?: boolean | null;
  ownerEntityId?: string | null;
  annualPropertyTax?: string;
  propertyTaxGrowthRate?: string;
  growthSource?: string;
  modelPortfolioId?: string | null;
  turnoverPct?: string;
  overridePctOi?: string | null;
  overridePctLtCg?: string | null;
  overridePctQdiv?: string | null;
  overridePctTaxExempt?: string | null;
}

export interface ModelPortfolioOption {
  id: string;
  name: string;
  blendedReturn: number;
}

export interface EntityOption {
  id: string;
  name: string;
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
  onSuccess?: () => void;
  onDelete?: () => void;
}

const SUB_TYPE_BY_CATEGORY: Record<AccountCategory, string[]> = {
  taxable: ["brokerage", "trust", "other"],
  cash: ["savings", "checking", "other"],
  retirement: ["traditional_ira", "roth_ira", "401k", "roth_401k", "529", "other"],
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
  roth_401k: "Roth 401(k)",
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

const RETIREMENT_SUB_TYPES = new Set(["traditional_ira", "roth_ira", "401k", "roth_401k", "529"]);
const RMD_ELIGIBLE_SUB_TYPES = new Set(["traditional_ira", "401k"]);

export default function AddAccountForm({
  clientId,
  category: defaultCategory,
  mode = "create",
  initial,
  entities,
  categoryDefaults,
  ownerNames,
  modelPortfolios,
  assetClasses,
  portfolioAllocationsMap,
  categoryDefaultSources,
  milestones,
  clientFirstName,
  spouseFirstName,
  onSuccess,
  onDelete,
}: AddAccountFormProps) {
  const clientLabel = ownerNames?.clientName ?? "Client";
  const spouseLabel = ownerNames?.spouseName ?? null;
  const router = useRouter();
  const isEdit = mode === "edit" && !!initial;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<AccountCategory>(
    initial?.category ?? defaultCategory ?? "taxable"
  );
  const [activeTab, setActiveTab] = useState<"details" | "savings" | "realization" | "asset_mix">("details");
  const [subType, setSubType] = useState(
    initial?.subType ?? SUB_TYPE_BY_CATEGORY[defaultCategory ?? "taxable"][0]
  );
  const [rmdEnabled, setRmdEnabled] = useState<boolean>(
    initial?.rmdEnabled ?? RMD_ELIGIBLE_SUB_TYPES.has(
      initial?.subType ?? SUB_TYPE_BY_CATEGORY[defaultCategory ?? "taxable"][0]
    )
  );
  const [annualPropertyTax, setAnnualPropertyTax] = useState(initial?.annualPropertyTax ?? "0");
  const [propertyTaxGrowthRate, setPropertyTaxGrowthRate] = useState(
    initial?.propertyTaxGrowthRate != null ? (Number(initial.propertyTaxGrowthRate) * 100).toString() : "3"
  );

  // Owner selection: either an "individual" owner (client/spouse/joint) or an entity id.
  type OwnerChoice = { kind: "individual"; value: string } | { kind: "entity"; value: string };
  const initialOwnerChoice: OwnerChoice = initial?.ownerEntityId
    ? { kind: "entity", value: initial.ownerEntityId }
    : { kind: "individual", value: initial?.owner ?? "client" };
  const [ownerChoice, setOwnerChoice] = useState<OwnerChoice>(initialOwnerChoice);

  // Growth source: "default" (category default), "model_portfolio", or "custom"
  const isInvestable = ["taxable", "cash", "retirement"].includes(category);
  const [growthSource, setGrowthSource] = useState<"default" | "model_portfolio" | "custom" | "asset_mix">(
    (initial?.growthSource as "default" | "model_portfolio" | "custom" | "asset_mix") ?? "default"
  );
  const [modelPortfolioId, setModelPortfolioId] = useState<string>(
    initial?.modelPortfolioId ?? ""
  );
  const [customAllocations, setCustomAllocations] = useState<{ assetClassId: string; weight: number }[]>([]);
  const [allocationsLoaded, setAllocationsLoaded] = useState(false);

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

  // Savings (create-only) year state — enables MilestoneYearPicker fallback
  const [savingsStartYear, setSavingsStartYear] = useState<number>(currentYear);
  const [savingsEndYear, setSavingsEndYear] = useState<number>(currentYear + 20);
  const [savingsStartYearRef, setSavingsStartYearRef] = useState<YearRef | null>(null);
  const [savingsEndYearRef, setSavingsEndYearRef] = useState<YearRef | null>(null);

  const subTypes = SUB_TYPE_BY_CATEGORY[category];
  const isRetirementAccount = category === "retirement" && RETIREMENT_SUB_TYPES.has(subType);
  const showRmdCheckbox =
    category === "retirement" &&
    (subType === "traditional_ira" ||
      subType === "401k" ||
      subType === "roth_ira" ||
      subType === "roth_401k" ||
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
    setLoading(true);
    setError(null);

    const form = e.currentTarget;
    const data = new FormData(form);

    const individualOwner = ownerChoice.kind === "individual" ? ownerChoice.value : "client";
    const ownerEntityId = ownerChoice.kind === "entity" ? ownerChoice.value : null;

    const growthRate = growthSource === "custom"
      ? String(Number(data.get("growthRate")) / 100)
      : isInvestable ? null : String(Number(data.get("growthRate")) / 100);

    const toPctOrNull = (name: string) => {
      const v = data.get(name) as string;
      return v !== "" && v != null ? String(Number(v) / 100) : null;
    };

    const accountBody = {
      name: data.get("name") as string,
      category: data.get("category") as string,
      subType: data.get("subType") as string,
      owner: individualOwner,
      value: data.get("value") as string,
      basis: data.get("basis") as string,
      growthRate,
      rmdEnabled,
      ownerEntityId,
      growthSource: isInvestable ? growthSource : "custom",
      modelPortfolioId: growthSource === "model_portfolio" ? modelPortfolioId : null,
      turnoverPct: toPctOrNull("turnoverPct") ?? "0",
      overridePctOi: toPctOrNull("overridePctOi"),
      overridePctLtCg: toPctOrNull("overridePctLtCg"),
      overridePctQdiv: toPctOrNull("overridePctQdiv"),
      overridePctTaxExempt: toPctOrNull("overridePctTaxExempt"),
      annualPropertyTax: category === "real_estate" ? annualPropertyTax : undefined,
      propertyTaxGrowthRate: category === "real_estate" ? String(Number(propertyTaxGrowthRate) / 100) : undefined,
    };

    try {
      if (isEdit) {
        const res = await fetch(`/api/clients/${clientId}/accounts/${initial!.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(accountBody),
        });
        if (!res.ok) {
          const json = await res.json();
          throw new Error(json.error ?? "Failed to update account");
        }
        // Save asset mix allocations for existing account
        if (showAssetMixTab && customAllocations.length > 0) {
          await fetch(`/api/clients/${clientId}/accounts/${initial!.id}/allocations`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ allocations: customAllocations }),
          });
        }
      } else {
        const res = await fetch(`/api/clients/${clientId}/accounts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(accountBody),
        });
        if (!res.ok) {
          const json = await res.json();
          throw new Error(json.error ?? "Failed to create account");
        }
        const account = await res.json();

        // Save asset mix allocations for new account
        if (showAssetMixTab && customAllocations.length > 0) {
          await fetch(`/api/clients/${clientId}/accounts/${account.id}/allocations`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ allocations: customAllocations }),
          });
        }

        // Create savings rule if savings tab filled (create-only)
        const savingsAmount = data.get("savingsAmount") as string;
        if (savingsAmount && Number(savingsAmount) > 0) {
          const matchPct = data.get("employerMatchPct") as string;
          const matchCap = data.get("employerMatchCap") as string;
          const limit = data.get("annualLimit") as string;

          const savingsBody = {
            accountId: account.id,
            annualAmount: savingsAmount,
            startYear: String(savingsStartYear),
            endYear: String(savingsEndYear),
            startYearRef: savingsStartYearRef,
            endYearRef: savingsEndYearRef,
            employerMatchPct: matchPct ? String(Number(matchPct) / 100) : null,
            employerMatchCap: matchCap ? String(Number(matchCap) / 100) : null,
            annualLimit: limit || null,
          };

          const savingsRes = await fetch(`/api/clients/${clientId}/savings-rules`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(savingsBody),
          });
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
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <p className="rounded bg-red-900/50 px-3 py-2 text-sm text-red-400">{error}</p>
      )}

      {/* Tab bar */}
      <div className="flex border-b border-gray-700">
        <button
          type="button"
          onClick={() => setActiveTab("details")}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
            activeTab === "details"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-gray-400 hover:text-gray-200"
          }`}
        >
          Account Details
        </button>
        {!isEdit && (
          <button
            type="button"
            onClick={() => setActiveTab("savings")}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              activeTab === "savings"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-400 hover:text-gray-200"
            }`}
          >
            Savings
          </button>
        )}
        {category === "taxable" && (
          <button
            type="button"
            onClick={() => setActiveTab("realization")}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              activeTab === "realization"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-400 hover:text-gray-200"
            }`}
          >
            Realization
          </button>
        )}
        {showAssetMixTab && (
          <button
            type="button"
            onClick={() => setActiveTab("asset_mix")}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              activeTab === "asset_mix"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-400 hover:text-gray-200"
            }`}
          >
            Asset Mix
          </button>
        )}
      </div>

      {/* Account Details */}
      <div className={activeTab !== "details" ? "hidden" : ""}>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300" htmlFor="name">
              Account Name <span className="text-red-500">*</span>
            </label>
            <input
              id="name"
              name="name"
              type="text"
              required
              defaultValue={initial?.name ?? ""}
              placeholder="e.g., Fidelity Brokerage"
              className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300" htmlFor="category">
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
                }}
                className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {(Object.keys(CATEGORY_LABELS) as AccountCategory[]).map((cat) => (
                  <option key={cat} value={cat}>{CATEGORY_LABELS[cat]}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300" htmlFor="subType">
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
                }}
                className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {subTypes.map((t) => (
                  <option key={t} value={t}>
                    {SUB_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300" htmlFor="owner">
                Owner
              </label>
              <select
                id="owner"
                value={ownerChoice.kind === "individual" ? `ind:${ownerChoice.value}` : `ent:${ownerChoice.value}`}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v.startsWith("ind:")) setOwnerChoice({ kind: "individual", value: v.slice(4) });
                  else if (v.startsWith("ent:")) setOwnerChoice({ kind: "entity", value: v.slice(4) });
                }}
                className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="ind:client">{clientLabel}</option>
                <option value="ind:spouse" disabled={!spouseLabel}>
                  {spouseLabel ?? "Spouse (none on file)"}
                </option>
                <option value="ind:joint">Joint</option>
                {entities && entities.length > 0 && (
                  <optgroup label="Entities (out of estate)">
                    {entities.map((ent) => (
                      <option key={ent.id} value={`ent:${ent.id}`}>{ent.name}</option>
                    ))}
                  </optgroup>
                )}
              </select>
              {ownerChoice.kind === "entity" && (
                <p className="mt-1 text-xs text-amber-400">Counted as out of estate.</p>
              )}
            </div>

            {isInvestable ? (
              <div>
                <label className="block text-sm font-medium text-gray-300">Growth Rate</label>
                <select
                  value={growthSource === "model_portfolio" ? `mp:${modelPortfolioId}` : growthSource}
                  onChange={(e) => handleGrowthSourceChange(e.target.value)}
                  className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="default">
                    Use category default{catDefaultSource?.portfolioName ? ` — ${catDefaultSource.portfolioName}` : ""}{defaultPctForCategory !== null ? ` (${defaultPctForCategory}%)` : ""}
                  </option>
                  {modelPortfolios?.map((mp) => (
                    <option key={mp.id} value={`mp:${mp.id}`}>
                      {mp.name} ({(mp.blendedReturn * 100).toFixed(2)}%)
                    </option>
                  ))}
                  {ASSET_MIX_CATEGORIES.includes(category) && (
                    <option value="asset_mix">Asset mix (custom)</option>
                  )}
                  <option value="custom">Custom %</option>
                </select>
                {growthSource === "custom" && (
                  <div className="mt-2">
                    <PercentInput
                      id="growthRate"
                      name="growthRate"
                      defaultValue={hasExplicitGrowth ? initialGrowthPct : 7}
                      className="block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                )}
              </div>
            ) : (
              <div>
                <label className="block text-sm font-medium text-gray-300" htmlFor="growthRate">
                  Growth Rate (%)
                </label>
                <PercentInput
                  id="growthRate"
                  name="growthRate"
                  defaultValue={initialGrowthPct}
                  className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-300" htmlFor="value">
                Current Value ($)
              </label>
              <CurrencyInput
                id="value"
                name="value"
                defaultValue={initial?.value ?? 0}
                className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 pr-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300" htmlFor="basis">
                Cost Basis ($)
              </label>
              <CurrencyInput
                id="basis"
                name="basis"
                defaultValue={initial?.basis ?? 0}
                className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 pr-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>

          {category === "real_estate" && (
            <>
              <h4 className="col-span-2 mt-2 text-sm font-medium text-gray-400">Real Estate Details</h4>
              <div>
                <label className="block text-sm font-medium text-gray-300" htmlFor="annualPropertyTax">
                  Annual Property Tax ($)
                </label>
                <CurrencyInput
                  id="annualPropertyTax"
                  value={annualPropertyTax}
                  onChange={(raw) => setAnnualPropertyTax(raw)}
                  className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 pr-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300" htmlFor="propertyTaxGrowthRate">
                  Property Tax Growth Rate (%)
                </label>
                <PercentInput
                  id="propertyTaxGrowthRate"
                  value={propertyTaxGrowthRate}
                  onChange={(raw) => setPropertyTaxGrowthRate(raw)}
                  className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </>
          )}

          {showRmdCheckbox && (
            <div className="mt-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={rmdEnabled}
                  onChange={(e) => setRmdEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-600 bg-gray-800 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm font-medium text-gray-300">Subject to RMDs</span>
              </label>
              <p className="mt-1 ml-6 text-xs text-gray-500">
                Required Minimum Distributions apply to pre-tax retirement accounts starting at age 73 or 75.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Savings tab — create only */}
      {!isEdit && (
        <div className={activeTab === "savings" ? "" : "hidden"}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300" htmlFor="savingsAmount">
                  Annual Contribution ($)
                </label>
                <CurrencyInput
                  id="savingsAmount"
                  name="savingsAmount"
                  defaultValue={0}
                  className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 pr-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300" htmlFor="annualLimit">
                  Annual Limit ($)
                </label>
                <CurrencyInput
                  id="annualLimit"
                  name="annualLimit"
                  placeholder="Optional"
                  className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 pr-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
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
                />
              ) : (
                <div>
                  <label className="block text-sm font-medium text-gray-300" htmlFor="savingsStartYear">
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
                    className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
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
                />
              ) : (
                <div>
                  <label className="block text-sm font-medium text-gray-300" htmlFor="savingsEndYear">
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
                    className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              )}
            </div>

            {isRetirementAccount && (
              <div className="grid grid-cols-2 gap-4 border-t border-gray-700 pt-4">
                <p className="col-span-2 text-xs font-medium uppercase tracking-wider text-gray-400">Employer Match</p>
                <div>
                  <label className="block text-sm font-medium text-gray-300" htmlFor="employerMatchPct">
                    Match Rate (%)
                  </label>
                  <PercentInput
                    id="employerMatchPct"
                    name="employerMatchPct"
                    placeholder="e.g., 50"
                    className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300" htmlFor="employerMatchCap">
                    Match Cap (% of salary)
                  </label>
                  <PercentInput
                    id="employerMatchCap"
                    name="employerMatchCap"
                    placeholder="e.g., 6"
                    className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Realization tab — taxable and retirement accounts */}
      {category === "taxable" && (
        <div className={activeTab === "realization" ? "" : "hidden"}>
          <div className="space-y-4">
            <p className="text-xs text-gray-500">
              How growth is realized for tax purposes. Leave blank to inherit from the model portfolio.
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300">Ordinary Income %</label>
                <PercentInput name="overridePctOi"
                  defaultValue={initial?.overridePctOi ? (Number(initial.overridePctOi) * 100).toFixed(2) : ""}
                  placeholder="From portfolio"
                  className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder:text-gray-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300">LT Capital Gains %</label>
                <PercentInput name="overridePctLtCg"
                  defaultValue={initial?.overridePctLtCg ? (Number(initial.overridePctLtCg) * 100).toFixed(2) : ""}
                  placeholder="From portfolio"
                  className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder:text-gray-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300">Qualified Dividends %</label>
                <PercentInput name="overridePctQdiv"
                  defaultValue={initial?.overridePctQdiv ? (Number(initial.overridePctQdiv) * 100).toFixed(2) : ""}
                  placeholder="From portfolio"
                  className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder:text-gray-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300">Tax-Exempt %</label>
                <PercentInput name="overridePctTaxExempt"
                  defaultValue={initial?.overridePctTaxExempt ? (Number(initial.overridePctTaxExempt) * 100).toFixed(2) : ""}
                  placeholder="From portfolio"
                  className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder:text-gray-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300">Turnover %</label>
                <PercentInput name="turnoverPct"
                  defaultValue={initial?.turnoverPct ? (Number(initial.turnoverPct) * 100).toFixed(2) : "0"}
                  className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
                <p className="mt-1 text-xs text-gray-500">Portion of LT CG realized as short-term each year.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Asset Mix tab */}
      {showAssetMixTab && assetClasses && (
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

      <div className="flex items-center justify-between pt-2">
        {isEdit && onDelete ? (
          <button
            type="button"
            onClick={onDelete}
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
          {loading ? "Saving…" : isEdit ? "Save Changes" : "Add Account"}
        </button>
      </div>
    </form>
  );
}
