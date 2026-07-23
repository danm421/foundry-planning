"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PercentInput } from "@/components/percent-input";
import { HelpTip } from "@/components/help-tip";
import { useClientAccess } from "@/components/client-access-provider";
import { RISK_LEVELS, RISK_LEVEL_LABELS, type RiskLevel } from "@/lib/risk-levels";

interface ModelPortfolioOption {
  id: string;
  name: string;
  blendedReturn: number;
  riskLevel: RiskLevel | null;
}

interface GrowthInflationFormProps {
  clientId: string;
  riskTolerance?: string | null;
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
  medicarePremiumInflationRate?: string;
  medicarePremiumInflationEnabled: boolean;
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

const INPUT_CLS =
  "block w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-1.5 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";

function SectionTitle({ title, help }: { title: string; help?: string }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-300">{title}</h3>
      {help && <HelpTip text={help} />}
    </div>
  );
}

export default function GrowthInflationForm({ clientId, riskTolerance, modelPortfolios, taxInflationRate, ssWageGrowthRate, medicarePremiumInflationRate, medicarePremiumInflationEnabled, inflationRateSource: initialInflationRateSource, resolvedInflationRate, hasInflationAssetClass, ...rates }: GrowthInflationFormProps) {
  const { permission } = useClientAccess();
  const canEdit = permission === "edit";
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(
    Boolean(taxInflationRate || ssWageGrowthRate || medicarePremiumInflationRate)
  );
  const [medicareInflEnabled, setMedicareInflEnabled] = useState(medicarePremiumInflationEnabled);
  const [inflationRateSource, setInflationRateSource] = useState<"asset_class" | "custom">(
    initialInflationRateSource
  );
  const [riskTol, setRiskTol] = useState<string>(riskTolerance ?? "");

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

  const taggedForTol = (lvl: string) => modelPortfolios?.find((p) => p.riskLevel === lvl) ?? null;

  function applyRiskPortfolio() {
    const pf = taggedForTol(riskTol);
    if (!pf) return; // untagged rung: the inline note explains why nothing changed
    setSource("taxable", `mp:${pf.id}`);
    setSource("retirement", `mp:${pf.id}`);
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
    const medicareInflRaw = (data.get("medicarePremiumInflationRate") as string) || "";
    body.taxInflationRate = taxInflRaw ? Number(taxInflRaw) / 100 : null;
    body.ssWageGrowthRate = ssWageGrowthRaw ? Number(ssWageGrowthRaw) / 100 : null;
    if (medicareInflRaw) body.medicarePremiumInflationRate = Number(medicareInflRaw) / 100;
    body.medicarePremiumInflationEnabled = medicareInflEnabled;

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
      if ((riskTolerance ?? "") !== riskTol) {
        await fetch(`/api/clients/${clientId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ riskTolerance: riskTol || null }),
        });
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  // Shared grid template: Category | Source | Rate (60 char | 1fr | 8rem)
  const ROW_GRID = "grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_8rem] items-center gap-3 px-3 py-2";

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && <p className="rounded bg-red-900/50 px-3 py-2 text-sm text-red-400">{error}</p>}
      {success && <p className="rounded bg-green-900/50 px-3 py-2 text-sm text-green-400">Saved.</p>}

      <fieldset disabled={!canEdit} className="space-y-6 border-0 p-0 m-0">
      <section>
        <SectionTitle
          title="Inflation"
          help="Annual inflation rate applied to expenses and incomes across the projection."
        />
        <div className="inline-block min-w-[20rem] divide-y divide-gray-800 rounded-md border border-gray-800 bg-gray-900/40">
          <label
            className={`flex items-center gap-3 px-3 py-2 text-sm ${
              hasInflationAssetClass ? "text-gray-200 cursor-pointer" : "text-gray-400 cursor-not-allowed"
            }`}
          >
            <input
              type="radio"
              name="inflationRateSource"
              value="asset_class"
              checked={inflationRateSource === "asset_class"}
              disabled={!hasInflationAssetClass}
              onChange={() => setInflationRateSource("asset_class")}
            />
            <span className="w-24">Asset class</span>
            <span className="tabular-nums text-xs text-gray-300">
              {(resolvedInflationRate * 100).toFixed(2)}%
            </span>
            {!hasInflationAssetClass && (
              <HelpTip text="No Inflation asset class is configured for this firm — set one in firm CMA to use this option." />
            )}
          </label>
          <label className="flex items-center gap-3 px-3 py-2 text-sm text-gray-200 cursor-pointer">
            <input
              type="radio"
              name="inflationRateSource"
              value="custom"
              checked={inflationRateSource === "custom"}
              onChange={() => setInflationRateSource("custom")}
            />
            <span className="w-24">Custom</span>
            <PercentInput
              id="inflationRate"
              name="inflationRate"
              defaultValue={pct(rates.inflationRate)}
              disabled={inflationRateSource !== "custom"}
              className={`w-24 rounded-md border border-gray-700 bg-gray-900 px-2 py-0.5 text-right text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent ${inflationRateSource !== "custom" ? "opacity-50" : ""}`}
            />
          </label>
        </div>
      </section>

      <section>
        <SectionTitle
          title="Default Growth Rates"
          help="Applied to every account of the given category unless that account specifies its own growth rate."
        />

        <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-hair pb-3">
          <label htmlFor="risk-tol" className="text-sm font-medium text-gray-100">Risk tolerance</label>
          <select
            id="risk-tol"
            value={riskTol}
            onChange={(e) => setRiskTol(e.target.value)}
            className={INPUT_CLS}
          >
            <option value="">Not specified</option>
            {RISK_LEVELS.map((lvl) => (
              <option key={lvl} value={lvl}>{RISK_LEVEL_LABELS[lvl]}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={applyRiskPortfolio}
            disabled={!riskTol}
            className="rounded-md border border-hair px-2 py-1 text-sm text-ink-2 disabled:opacity-40"
          >
            Apply to portfolios
          </button>
          {riskTol && !taggedForTol(riskTol) && (
            <span className="text-xs text-warn">
              No {RISK_LEVEL_LABELS[riskTol as RiskLevel]} model tagged — <a href="/cma" className="underline">tag one</a>.
            </span>
          )}
        </div>

        <div className="overflow-hidden rounded-md border border-gray-800 bg-gray-900/40">
          <div className={`${ROW_GRID} border-b border-gray-800 bg-gray-900/60 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400`}>
            <span>Category</span>
            <span>Source</span>
            <span className="text-right">Rate</span>
          </div>

          <div className="divide-y divide-gray-800">
            {/* Investable categories — dropdown for model portfolio or custom */}
            {CMA_CATEGORIES.map((cat) => {
              const s = sources[cat.category];
              const selectVal =
                s.source === "model_portfolio" ? `mp:${s.portfolioId}` :
                s.source === "asset_mix" ? "asset_mix" :
                s.source === "inflation" ? "inflation" :
                "custom";
              return (
                <div key={cat.category} className={ROW_GRID}>
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-sm font-medium text-gray-100">{cat.label}</span>
                    <HelpTip text={cat.description} />
                    {s.source === "asset_mix" && (
                      <HelpTip text="Each account uses its own asset mix. Accounts without a defined mix grow at the Inflation rate." />
                    )}
                  </div>
                  <select
                    value={selectVal}
                    onChange={(e) => setSource(cat.category, e.target.value)}
                    className={INPUT_CLS}
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
                  <div className="justify-self-end">
                    {s.source === "custom" ? (
                      <PercentInput
                        name={cat.rateKey}
                        defaultValue={pct((rates as Record<string, string>)[cat.rateKey])}
                        className="block w-28 rounded-md border border-gray-700 bg-gray-900 px-3 py-1.5 text-right text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                    ) : (
                      <>
                        <span className="block w-28 px-1 text-right text-xs text-gray-500">—</span>
                        <input type="hidden" name={cat.rateKey} value={pct((rates as Record<string, string>)[cat.rateKey])} />
                      </>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Non-investable categories — Inflation or Custom % */}
            {FLAT_RATE_FIELDS.map((field) => {
              const flatSource = flatSources[field.category];
              return (
                <div key={field.key} className={ROW_GRID}>
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-sm font-medium text-gray-100">{field.label}</span>
                    <HelpTip text={field.description} />
                  </div>
                  <select
                    value={flatSource}
                    onChange={(e) =>
                      setFlatSources((prev) => ({ ...prev, [field.category]: e.target.value as "inflation" | "custom" }))
                    }
                    className={INPUT_CLS}
                  >
                    <option value="inflation">Inflation ({(resolvedInflationRate * 100).toFixed(2)}%)</option>
                    <option value="custom">Custom %</option>
                  </select>
                  <div className="justify-self-end">
                    {flatSource === "custom" ? (
                      <PercentInput
                        id={field.key}
                        name={field.key}
                        defaultValue={pct((rates as Record<string, string>)[field.key])}
                        className="block w-28 rounded-md border border-gray-700 bg-gray-900 px-3 py-1.5 text-right text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                    ) : (
                      <>
                        <span className="block w-28 px-1 text-right text-xs text-gray-500">—</span>
                        <input type="hidden" name={field.key} value={pct((rates as Record<string, string>)[field.key])} />
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <details
        className="rounded border border-gray-800 p-3"
        open={advancedOpen}
        onToggle={(e) => setAdvancedOpen((e.currentTarget as HTMLDetailsElement).open)}
      >
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-gray-300">
          Advanced — separate tax &amp; SS inflation
        </summary>

        <div className="mt-3 divide-y divide-gray-800 rounded-md border border-gray-800 bg-gray-900/40">
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] items-center gap-3 px-3 py-2">
            <div className="flex items-center gap-1.5 text-xs font-medium text-gray-300">
              <span>Tax bracket inflation</span>
              <HelpTip text="Used to inflate IRS-published thresholds (brackets, deductions, AMT, contribution limits) into future projection years." />
            </div>
            <PercentInput
              id="taxInflationRate"
              name="taxInflationRate"
              defaultValue={taxInflationRate ? pct(taxInflationRate) : ""}
              placeholder={`Defaults to ${(resolvedInflationRate * 100).toFixed(2)} (general)`}
              className={`${INPUT_CLS} max-w-[14rem]`}
            />
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] items-center gap-3 px-3 py-2">
            <div className="flex items-center gap-1.5 text-xs font-medium text-gray-300">
              <span>SS wage base growth</span>
              <HelpTip text="Used to inflate the Social Security wage base into future projection years. Wages typically outpace CPI by ~0.5%." />
            </div>
            <PercentInput
              id="ssWageGrowthRate"
              name="ssWageGrowthRate"
              defaultValue={ssWageGrowthRate ? pct(ssWageGrowthRate) : ""}
              placeholder={`Defaults to ${(resolvedInflationRate * 100).toFixed(2)} + 0.5%`}
              className={`${INPUT_CLS} max-w-[14rem]`}
            />
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] items-center gap-3 px-3 py-2">
            <div className="flex items-center gap-1.5 text-xs font-medium text-gray-300">
              <span>Medicare premium inflation</span>
              <HelpTip text="When on, inflates Part B premiums, Part D national base, IRMAA bracket dollars, Medigap, and Part D plan premiums forward from the latest CMS-published year. Turn off to project Medicare costs in today's dollars. Historical Medicare inflation has run ~4-6%/yr; the conservative default is 3%." />
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={medicareInflEnabled}
                  onChange={(e) => setMedicareInflEnabled(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-gray-700 bg-gray-900 text-accent focus:ring-1 focus:ring-accent"
                />
                <span>On</span>
              </label>
              <PercentInput
                id="medicarePremiumInflationRate"
                name="medicarePremiumInflationRate"
                defaultValue={medicarePremiumInflationRate ? pct(medicarePremiumInflationRate) : ""}
                placeholder="Defaults to 3.00%"
                disabled={!medicareInflEnabled}
                className={`${INPUT_CLS} max-w-[12rem] disabled:opacity-50`}
              />
            </div>
          </div>
        </div>
      </details>

      {resetMessage && (
        <p className="rounded bg-green-900/50 px-3 py-2 text-sm text-green-400">{resetMessage}</p>
      )}

      {canEdit && (
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
          <button type="submit" disabled={loading} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-on hover:bg-accent-ink disabled:opacity-50">
            {loading ? "Saving..." : "Save"}
          </button>
        </div>
      )}
      </fieldset>
    </form>
  );
}
