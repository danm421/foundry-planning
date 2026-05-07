"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PercentInput } from "@/components/percent-input";

interface ModelPortfolioOption {
  id: string;
  name: string;
  blendedReturn: number;
}

interface GrowthInflationFormProps {
  clientId: string;
  inflationRate: string;
  inflationRateSource: "asset_class" | "custom";
  resolvedInflationRate: number;
  hasInflationAssetClass: boolean;
  defaultGrowthTaxable: string;
  defaultGrowthCash: string;
  defaultGrowthRetirement: string;
  defaultGrowthRealEstate: string;
  defaultGrowthBusiness: string;
  defaultGrowthLifeInsurance: string;
  // CMA growth sources for investable categories
  growthSourceTaxable?: string;
  growthSourceCash?: string;
  growthSourceRetirement?: string;
  growthSourceRealEstate?: string;
  growthSourceBusiness?: string;
  growthSourceLifeInsurance?: string;
  modelPortfolioIdTaxable?: string | null;
  modelPortfolioIdCash?: string | null;
  modelPortfolioIdRetirement?: string | null;
  modelPortfolios?: ModelPortfolioOption[];
  // Optional advanced inflation overrides
  taxInflationRate?: string;
  ssWageGrowthRate?: string;
}

// Non-investable categories — choose between Inflation and Custom %
const FLAT_RATE_FIELDS: {
  key: string;
  label: string;
  description: string;
  category: "real_estate" | "business" | "life_insurance";
  sourceKey: "growthSourceRealEstate" | "growthSourceBusiness" | "growthSourceLifeInsurance";
}[] = [
  { key: "defaultGrowthRealEstate", label: "Real Estate", description: "Residences and property", category: "real_estate", sourceKey: "growthSourceRealEstate" },
  { key: "defaultGrowthBusiness", label: "Business", description: "Ownership interests and entities", category: "business", sourceKey: "growthSourceBusiness" },
  { key: "defaultGrowthLifeInsurance", label: "Life Insurance", description: "Cash-value life policies", category: "life_insurance", sourceKey: "growthSourceLifeInsurance" },
];

// Investable categories — support portfolio dropdown
const CMA_CATEGORIES: { category: string; label: string; description: string; rateKey: string; sourceKey: string; portfolioKey: string }[] = [
  { category: "taxable", label: "Taxable", description: "Brokerage, trust, other taxable accounts", rateKey: "defaultGrowthTaxable", sourceKey: "growthSourceTaxable", portfolioKey: "modelPortfolioIdTaxable" },
  { category: "cash", label: "Cash", description: "Savings, checking, money-market", rateKey: "defaultGrowthCash", sourceKey: "growthSourceCash", portfolioKey: "modelPortfolioIdCash" },
  { category: "retirement", label: "Retirement", description: "IRA, 401(k), Roth, 529", rateKey: "defaultGrowthRetirement", sourceKey: "growthSourceRetirement", portfolioKey: "modelPortfolioIdRetirement" },
];

const pct = (v: string) => (Number(v) * 100).toFixed(2);

export default function GrowthInflationForm({ clientId, modelPortfolios, taxInflationRate, ssWageGrowthRate, inflationRateSource: initialInflationRateSource, resolvedInflationRate, hasInflationAssetClass, ...rates }: GrowthInflationFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(
    Boolean(taxInflationRate || ssWageGrowthRate)
  );
  const [inflationRateSource, setInflationRateSource] = useState<"asset_class" | "custom">(
    initialInflationRateSource
  );

  async function handleResetAccounts() {
    if (!confirm("Reset all taxable, cash, and retirement accounts to use the category defaults above? Any account-level custom rates, portfolios, turnover, and realization overrides will be cleared.")) {
      return;
    }
    setResetting(true);
    setError(null);
    setResetMessage(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/reset-account-growth`, { method: "POST" });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? "Reset failed");
      }
      const { resetCount } = await res.json();
      setResetMessage(`Reset ${resetCount} account${resetCount === 1 ? "" : "s"} to use category defaults.`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed");
    } finally {
      setResetting(false);
    }
  }

  // State for each investable category's growth source
  const [sources, setSources] = useState<Record<string, { source: string; portfolioId: string }>>({
    taxable: {
      source: rates.growthSourceTaxable ?? "custom",
      portfolioId: rates.modelPortfolioIdTaxable ?? "",
    },
    cash: {
      source: rates.growthSourceCash ?? "custom",
      portfolioId: rates.modelPortfolioIdCash ?? "",
    },
    retirement: {
      source: rates.growthSourceRetirement ?? "custom",
      portfolioId: rates.modelPortfolioIdRetirement ?? "",
    },
  });

  // State for each non-investable category's growth source (inflation or custom)
  const [flatSources, setFlatSources] = useState<Record<string, "inflation" | "custom">>({
    real_estate: (rates.growthSourceRealEstate ?? "inflation") === "custom" ? "custom" : "inflation",
    business: (rates.growthSourceBusiness ?? "inflation") === "custom" ? "custom" : "inflation",
    life_insurance: (rates.growthSourceLifeInsurance ?? "inflation") === "custom" ? "custom" : "inflation",
  });

  function setSource(category: string, value: string) {
    if (value.startsWith("mp:")) {
      setSources((prev) => ({ ...prev, [category]: { source: "model_portfolio", portfolioId: value.slice(3) } }));
    } else if (value === "asset_mix") {
      setSources((prev) => ({ ...prev, [category]: { source: "asset_mix", portfolioId: "" } }));
    } else if (value === "inflation") {
      setSources((prev) => ({ ...prev, [category]: { source: "inflation", portfolioId: "" } }));
    } else {
      setSources((prev) => ({ ...prev, [category]: { source: "custom", portfolioId: "" } }));
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(false);

    const data = new FormData(e.currentTarget);
    const toDec = (name: string) => String(Number(data.get(name) as string) / 100);

    const body: Record<string, unknown> = {
      inflationRate: inflationRateSource === "custom" ? toDec("inflationRate") : undefined,
      inflationRateSource,
      defaultGrowthRealEstate: toDec("defaultGrowthRealEstate"),
      defaultGrowthBusiness: toDec("defaultGrowthBusiness"),
      defaultGrowthLifeInsurance: toDec("defaultGrowthLifeInsurance"),
      growthSourceRealEstate: flatSources.real_estate,
      growthSourceBusiness: flatSources.business,
      growthSourceLifeInsurance: flatSources.life_insurance,
    };

    // For each investable category, send growth source + portfolio id + custom rate
    for (const cat of CMA_CATEGORIES) {
      const s = sources[cat.category];
      body[cat.sourceKey] = s.source;
      body[cat.portfolioKey] = s.source === "model_portfolio" ? s.portfolioId : null;
      body[cat.rateKey] = toDec(cat.rateKey);
    }

    // Advanced optional inflation overrides — send null if blank
    const taxInflRaw = (data.get("taxInflationRate") as string) || "";
    const ssWageGrowthRaw = (data.get("ssWageGrowthRate") as string) || "";
    body.taxInflationRate = taxInflRaw ? Number(taxInflRaw) / 100 : null;
    body.ssWageGrowthRate = ssWageGrowthRaw ? Number(ssWageGrowthRaw) / 100 : null;

    try {
      const res = await fetch(`/api/clients/${clientId}/plan-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? "Failed to save");
      }
      setSuccess(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && <p className="rounded bg-red-900/50 px-3 py-2 text-sm text-red-400">{error}</p>}
      {success && <p className="rounded bg-green-900/50 px-3 py-2 text-sm text-green-400">Saved.</p>}

      <section>
        <header className="mb-3">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-300">Inflation</h3>
          <p className="mt-1 text-xs text-gray-400">Annual inflation rate applied to expenses and incomes.</p>
        </header>
        <div>
          <label className="block text-xs font-medium text-gray-300">Inflation rate</label>
          <div className="mt-1 flex flex-col gap-2 rounded border border-gray-700 bg-gray-900 p-3">
            <label className={`flex items-center gap-2 text-sm ${hasInflationAssetClass ? "text-gray-200" : "text-gray-400"}`}>
              <input
                type="radio"
                name="inflationRateSource"
                value="asset_class"
                checked={inflationRateSource === "asset_class"}
                disabled={!hasInflationAssetClass}
                onChange={() => setInflationRateSource("asset_class")}
              />
              Asset class — {(resolvedInflationRate * 100).toFixed(2)}%
            </label>
            {!hasInflationAssetClass && (
              <p className="pl-6 text-xs text-gray-400">No Inflation asset class configured for this firm.</p>
            )}
            <label className="flex items-center gap-2 text-sm text-gray-200">
              <input
                type="radio"
                name="inflationRateSource"
                value="custom"
                checked={inflationRateSource === "custom"}
                onChange={() => setInflationRateSource("custom")}
              />
              Custom
              <PercentInput
                id="inflationRate"
                name="inflationRate"
                defaultValue={pct(rates.inflationRate)}
                disabled={inflationRateSource !== "custom"}
                className={`ml-2 w-28 rounded-md border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent${inflationRateSource !== "custom" ? " opacity-50" : ""}`}
              />
            </label>
          </div>
        </div>
      </section>

      <section>
        <header className="mb-3">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-300">Default Growth Rates</h3>
          <p className="mt-1 text-xs text-gray-400">Applied to every account of the given category unless that account specifies its own growth rate.</p>
        </header>

        <div className="divide-y divide-gray-800 rounded-md border border-gray-800 bg-gray-900/60">
          {/* Investable categories — dropdown for model portfolio or custom */}
          {CMA_CATEGORIES.map((cat) => {
            const s = sources[cat.category];
            const selectVal =
              s.source === "model_portfolio" ? `mp:${s.portfolioId}` :
              s.source === "asset_mix" ? "asset_mix" :
              s.source === "inflation" ? "inflation" :
              "custom";
            return (
              <div key={cat.category} className="px-4 py-3">
                <div className="flex items-center justify-between gap-6">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-100">{cat.label}</p>
                    <p className="text-xs text-gray-400">{cat.description}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={selectVal}
                      onChange={(e) => setSource(cat.category, e.target.value)}
                      className="rounded-md border border-gray-700 bg-gray-800 px-2 py-1.5 text-sm text-gray-100 focus:border-accent focus:outline-none"
                    >
                      {modelPortfolios?.map((mp) => (
                        <option key={mp.id} value={`mp:${mp.id}`}>
                          {mp.name} ({(mp.blendedReturn * 100).toFixed(2)}%)
                        </option>
                      ))}
                      <option value="inflation">Inflation ({(resolvedInflationRate * 100).toFixed(2)}%)</option>
                      <option value="custom">Custom %</option>
                      {(cat.category === "taxable" || cat.category === "retirement") && (
                        <option value="asset_mix">Asset mix (per account)</option>
                      )}
                    </select>
                    {s.source === "custom" && (
                      <div className="w-28 flex-shrink-0">
                        <PercentInput
                          name={cat.rateKey}
                          defaultValue={pct((rates as Record<string, string>)[cat.rateKey])}
                          className="block w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-right text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                        />
                      </div>
                    )}
                    {/* Hidden input so the rate key is always submitted even when dropdown is shown */}
                    {s.source !== "custom" && (
                      <input type="hidden" name={cat.rateKey} value={pct((rates as Record<string, string>)[cat.rateKey])} />
                    )}
                  </div>
                </div>
                {s.source === "asset_mix" && (
                  <p className="text-xs text-gray-400 mt-1">
                    Each account uses its own asset mix. Accounts without a defined mix grow at the Inflation rate.
                  </p>
                )}
              </div>
            );
          })}

          {/* Non-investable categories — Inflation or Custom % */}
          {FLAT_RATE_FIELDS.map((field) => {
            const flatSource = flatSources[field.category];
            return (
              <div key={field.key} className="flex items-center justify-between gap-6 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-100">{field.label}</p>
                  <p className="text-xs text-gray-400">{field.description}</p>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={flatSource}
                    onChange={(e) =>
                      setFlatSources((prev) => ({ ...prev, [field.category]: e.target.value as "inflation" | "custom" }))
                    }
                    className="rounded-md border border-gray-700 bg-gray-800 px-2 py-1.5 text-sm text-gray-100 focus:border-accent focus:outline-none"
                  >
                    <option value="inflation">Inflation ({(resolvedInflationRate * 100).toFixed(2)}%)</option>
                    <option value="custom">Custom %</option>
                  </select>
                  {flatSource === "custom" ? (
                    <div className="w-28 flex-shrink-0">
                      <PercentInput
                        id={field.key}
                        name={field.key}
                        defaultValue={pct((rates as Record<string, string>)[field.key])}
                        className="block w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-right text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                    </div>
                  ) : (
                    <input type="hidden" name={field.key} value={pct((rates as Record<string, string>)[field.key])} />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <details
        className="mt-4 rounded border border-gray-800 p-3"
        open={advancedOpen}
        onToggle={(e) => setAdvancedOpen((e.currentTarget as HTMLDetailsElement).open)}
      >
        <summary className="cursor-pointer text-sm text-gray-300">Advanced — separate tax &amp; SS inflation</summary>

        <div className="mt-3 space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-300" htmlFor="taxInflationRate">
              Tax bracket inflation rate (% per year)
            </label>
            <PercentInput
              id="taxInflationRate"
              name="taxInflationRate"
              defaultValue={taxInflationRate ? pct(taxInflationRate) : ""}
              placeholder={`Defaults to ${pct(rates.inflationRate)} (general)`}
              className="mt-1 w-full rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-sm text-gray-100"
            />
            <p className="mt-1 text-xs text-gray-400">
              Used to inflate IRS-published thresholds (brackets, deductions, AMT, contribution limits) into future projection years.
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-300" htmlFor="ssWageGrowthRate">
              SS wage base growth rate (% per year)
            </label>
            <PercentInput
              id="ssWageGrowthRate"
              name="ssWageGrowthRate"
              defaultValue={ssWageGrowthRate ? pct(ssWageGrowthRate) : ""}
              placeholder={`Defaults to ${pct(rates.inflationRate)} + 0.5% (wages typically outpace CPI)`}
              className="mt-1 w-full rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-sm text-gray-100"
            />
          </div>
        </div>
      </details>

      {resetMessage && (
        <p className="rounded bg-green-900/50 px-3 py-2 text-sm text-green-400">{resetMessage}</p>
      )}

      <div className="flex items-center justify-between pt-2">
        <button
          type="button"
          onClick={handleResetAccounts}
          disabled={resetting}
          className="rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-xs font-medium text-gray-300 hover:bg-gray-700 disabled:opacity-50"
          title="Clear account-level overrides and fall back to the category defaults above"
        >
          {resetting ? "Resetting..." : "Reset all accounts to defaults"}
        </button>
        <button type="submit" disabled={loading} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-on hover:bg-accent-deep disabled:opacity-50">
          {loading ? "Saving..." : "Save"}
        </button>
      </div>
    </form>
  );
}
