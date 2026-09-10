"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PercentInput } from "@/components/percent-input";
import { FieldTooltip } from "@/components/forms/field-tooltip";
import { AutosaveStatus } from "@/components/autosave-status";
import { usePlanSettingsAutosave } from "@/components/forms/use-plan-settings-autosave";
import { selectClassName } from "@/components/forms/input-styles";
import { useClientAccess } from "@/components/client-access-provider";
import { RISK_LEVEL_LABELS, type RiskLevel } from "@/lib/risk-levels";

interface ModelPortfolioOption {
  id: string;
  name: string;
  blendedReturn: number;
  riskLevel: RiskLevel | null;
}

interface GrowthInflationFormProps {
  clientId: string;
  /** The household's composite risk level -- read-only here. Mutating it now
   *  happens on `/risk/[clientId]` (Tasks 10-13), not on this tab. */
  riskLevel?: RiskLevel | null;
  inflationRate: string;
  inflationRateSource: "asset_class" | "custom";
  /** The rate the *current* source resolves to — equals the custom rate when
   *  the source is custom. */
  resolvedInflationRate: number;
  /** The rate the "Asset class" option would resolve to, whatever the current
   *  source is. Kept separate because `resolvedInflationRate` collapses to the
   *  custom rate and would make the Asset class row quote the wrong number. */
  assetClassInflationRate: number;
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

/** A typed percent → the decimal fraction the API stores. `undefined` while the
 *  box holds something that isn't a number yet, so a half-typed value never
 *  reaches the database. */
function toDecimal(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return "0";
  const n = Number(trimmed);
  return Number.isFinite(n) ? String(n / 100) : undefined;
}

/** Same, for the advanced overrides whose blank state means "fall back to the
 *  general inflation rate". */
function toDecimalOrNull(raw: string): string | null | undefined {
  return raw.trim() === "" ? null : toDecimal(raw);
}

function SectionTitle({ title, help }: { title: string; help?: string }) {
  return (
    <div className="mb-2 flex items-center gap-1.5">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">{title}</h3>
      {help && <FieldTooltip text={help} />}
    </div>
  );
}

export default function GrowthInflationForm({ clientId, riskLevel, modelPortfolios, taxInflationRate, ssWageGrowthRate, medicarePremiumInflationRate, medicarePremiumInflationEnabled, inflationRateSource: initialInflationRateSource, resolvedInflationRate, assetClassInflationRate, hasInflationAssetClass, ...rates }: GrowthInflationFormProps) {
  const { permission } = useClientAccess();
  const canEdit = permission === "edit";
  const router = useRouter();
  const { save, state, error, retry } = usePlanSettingsAutosave(clientId);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(
    Boolean(taxInflationRate || ssWageGrowthRate || medicarePremiumInflationRate)
  );
  const [medicareInflEnabled, setMedicareInflEnabled] = useState(medicarePremiumInflationEnabled);
  const [inflationRateSource, setInflationRateSource] = useState<"asset_class" | "custom">(
    initialInflationRateSource
  );

  // Every rate is controlled so the `router.refresh()` a save triggers can't
  // rewrite a box that's still under the cursor.
  const [values, setValues] = useState<Record<string, string>>({
    inflationRate: pct(rates.inflationRate),
    defaultGrowthTaxable: pct(rates.defaultGrowthTaxable),
    defaultGrowthCash: pct(rates.defaultGrowthCash),
    defaultGrowthRetirement: pct(rates.defaultGrowthRetirement),
    defaultGrowthRealEstate: pct(rates.defaultGrowthRealEstate),
    defaultGrowthBusiness: pct(rates.defaultGrowthBusiness),
    defaultGrowthLifeInsurance: pct(rates.defaultGrowthLifeInsurance),
    taxInflationRate: taxInflationRate ? pct(taxInflationRate) : "",
    ssWageGrowthRate: ssWageGrowthRate ? pct(ssWageGrowthRate) : "",
    medicarePremiumInflationRate: medicarePremiumInflationRate ? pct(medicarePremiumInflationRate) : "",
  });

  function update(key: string, raw: string, apiValue: unknown) {
    setValues((v) => ({ ...v, [key]: raw }));
    if (apiValue !== undefined) save({ [key]: apiValue });
  }

  async function handleResetAccounts() {
    if (!confirm("Reset all taxable, cash, and retirement accounts to use the category defaults above? Any account-level custom rates, portfolios, turnover, and realization overrides will be cleared.")) {
      return;
    }
    setResetting(true);
    setResetError(null);
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
      setResetError(err instanceof Error ? err.message : "Reset failed");
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

  function setSource(cat: (typeof CMA_CATEGORIES)[number], value: string) {
    const next =
      value.startsWith("mp:")
        ? { source: "model_portfolio", portfolioId: value.slice(3) }
        : { source: value === "asset_mix" || value === "inflation" ? value : "custom", portfolioId: "" };
    setSources((prev) => ({ ...prev, [cat.category]: next }));
    save({
      [cat.sourceKey]: next.source,
      [cat.portfolioKey]: next.source === "model_portfolio" ? next.portfolioId : null,
    });
  }

  // The rate the "Inflation" options quote. Derived locally rather than read
  // back from the server so the dropdown labels track a custom rate as it is
  // typed -- `resolveInflationRate` returns exactly the stored custom rate when
  // the source is custom.
  const effectiveInflationRate =
    inflationRateSource === "custom"
      ? (Number(values.inflationRate) || 0) / 100
      : resolvedInflationRate;
  const inflationLabel = `Inflation (${(effectiveInflationRate * 100).toFixed(2)}%)`;

  // Shared grid template: Category | Source | Rate. The source column is
  // capped rather than fluid — on the widened page a 1.4fr select stretched
  // to ~500px for the word "Inflation".
  const ROW_GRID = "grid grid-cols-[minmax(0,1fr)_minmax(0,18rem)_8rem] items-center gap-3 px-3 py-2";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        {canEdit && <AutosaveStatus state={state} error={error} onRetry={retry} />}
      </div>

      <fieldset disabled={!canEdit} className="m-0 space-y-6 border-0 p-0">
      <section>
        <SectionTitle
          title="Inflation"
          help="Annual inflation rate applied to expenses and incomes across the projection."
        />
        <div className="inline-block min-w-80 divide-y divide-hair rounded-[var(--radius)] border border-hair bg-card">
          <label
            className={`flex items-center gap-3 px-3 py-2 text-sm ${
              hasInflationAssetClass ? "text-ink-2 cursor-pointer" : "text-ink-4 cursor-not-allowed"
            }`}
          >
            <input
              type="radio"
              name="inflationRateSource"
              value="asset_class"
              checked={inflationRateSource === "asset_class"}
              disabled={!hasInflationAssetClass}
              onChange={() => {
                setInflationRateSource("asset_class");
                save({ inflationRateSource: "asset_class" });
              }}
            />
            <span className="w-24">Asset class</span>
            <span className="tabular text-xs text-ink-3">
              {(assetClassInflationRate * 100).toFixed(2)}%
            </span>
            {!hasInflationAssetClass && (
              <FieldTooltip text="No Inflation asset class is configured for this firm — set one in firm CMA to use this option." />
            )}
          </label>
          <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm text-ink-2">
            <input
              type="radio"
              name="inflationRateSource"
              value="custom"
              checked={inflationRateSource === "custom"}
              onChange={() => {
                setInflationRateSource("custom");
                save({
                  inflationRateSource: "custom",
                  inflationRate: toDecimal(values.inflationRate),
                });
              }}
            />
            <span className="w-24">Custom</span>
            <div className="w-24">
              <PercentInput
                id="inflationRate"
                value={values.inflationRate}
                disabled={inflationRateSource !== "custom"}
                onChange={(raw) => update("inflationRate", raw, toDecimal(raw))}
                className="text-right"
              />
            </div>
          </label>
        </div>
      </section>

      <section>
        <SectionTitle
          title="Default Growth Rates"
          help="Applied to every account of the given category unless that account specifies its own growth rate."
        />

        <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-hair pb-3">
          <span className="text-sm font-medium text-ink">Risk tolerance</span>
          <span className="text-sm text-ink-2">
            {riskLevel ? RISK_LEVEL_LABELS[riskLevel] : "Not established"}
          </span>
          <Link href={`/risk/${clientId}`} className="text-sm text-accent hover:underline">
            Manage risk profile
          </Link>
        </div>

        <div className="overflow-hidden rounded-[var(--radius)] border border-hair bg-card">
          <div className={`${ROW_GRID} border-b border-hair bg-card-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-3`}>
            <span>Category</span>
            <span>Source</span>
            <span className="text-right">Rate</span>
          </div>

          <div className="divide-y divide-hair">
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
                    <span className="truncate text-sm font-medium text-ink">{cat.label}</span>
                    <FieldTooltip text={cat.description} />
                    {s.source === "asset_mix" && (
                      <FieldTooltip text="Each account uses its own asset mix. Accounts without a defined mix grow at the Inflation rate." />
                    )}
                  </div>
                  <select
                    value={selectVal}
                    onChange={(e) => setSource(cat, e.target.value)}
                    className={selectClassName}
                  >
                    {modelPortfolios?.map((mp) => (
                      <option key={mp.id} value={`mp:${mp.id}`}>
                        {mp.name} ({(mp.blendedReturn * 100).toFixed(2)}%)
                      </option>
                    ))}
                    <option value="inflation">{inflationLabel}</option>
                    <option value="custom">Custom %</option>
                    {(cat.category === "taxable" || cat.category === "retirement") && (
                      <option value="asset_mix">Asset mix (per account)</option>
                    )}
                  </select>
                  <div className="justify-self-end">
                    {s.source === "custom" ? (
                      <div className="w-28">
                        <PercentInput
                          id={cat.rateKey}
                          value={values[cat.rateKey]}
                          onChange={(raw) => update(cat.rateKey, raw, toDecimal(raw))}
                          className="text-right"
                        />
                      </div>
                    ) : (
                      <span className="block w-28 px-1 text-right text-xs text-ink-4">—</span>
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
                    <span className="truncate text-sm font-medium text-ink">{field.label}</span>
                    <FieldTooltip text={field.description} />
                  </div>
                  <select
                    value={flatSource}
                    onChange={(e) => {
                      const next = e.target.value as "inflation" | "custom";
                      setFlatSources((prev) => ({ ...prev, [field.category]: next }));
                      save({ [field.sourceKey]: next });
                    }}
                    className={selectClassName}
                  >
                    <option value="inflation">{inflationLabel}</option>
                    <option value="custom">Custom %</option>
                  </select>
                  <div className="justify-self-end">
                    {flatSource === "custom" ? (
                      <div className="w-28">
                        <PercentInput
                          id={field.key}
                          value={values[field.key]}
                          onChange={(raw) => update(field.key, raw, toDecimal(raw))}
                          className="text-right"
                        />
                      </div>
                    ) : (
                      <span className="block w-28 px-1 text-right text-xs text-ink-4">—</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <details
        className="rounded-[var(--radius)] border border-hair p-3"
        open={advancedOpen}
        onToggle={(e) => setAdvancedOpen((e.currentTarget as HTMLDetailsElement).open)}
      >
        <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">
          Advanced — separate tax &amp; SS inflation
        </summary>

        <div className="mt-3 divide-y divide-hair rounded-[var(--radius)] border border-hair bg-card">
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] items-center gap-3 px-3 py-2">
            <label htmlFor="taxInflationRate" className="flex items-center gap-1.5 text-[13px] font-medium text-ink-2">
              <span>Tax bracket inflation</span>
              <FieldTooltip text="Used to inflate IRS-published thresholds (brackets, deductions, AMT, contribution limits) into future projection years." />
            </label>
            <div className="max-w-56">
              <PercentInput
                id="taxInflationRate"
                value={values.taxInflationRate}
                placeholder={`Defaults to ${(effectiveInflationRate * 100).toFixed(2)} (general)`}
                onChange={(raw) => update("taxInflationRate", raw, toDecimalOrNull(raw))}
              />
            </div>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] items-center gap-3 px-3 py-2">
            <label htmlFor="ssWageGrowthRate" className="flex items-center gap-1.5 text-[13px] font-medium text-ink-2">
              <span>SS wage base growth</span>
              <FieldTooltip text="Used to inflate the Social Security wage base into future projection years. Wages typically outpace CPI by ~0.5%." />
            </label>
            <div className="max-w-56">
              <PercentInput
                id="ssWageGrowthRate"
                value={values.ssWageGrowthRate}
                placeholder={`Defaults to ${(effectiveInflationRate * 100).toFixed(2)} + 0.5%`}
                onChange={(raw) => update("ssWageGrowthRate", raw, toDecimalOrNull(raw))}
              />
            </div>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] items-center gap-3 px-3 py-2">
            <label htmlFor="medicarePremiumInflationRate" className="flex items-center gap-1.5 text-[13px] font-medium text-ink-2">
              <span>Medicare premium inflation</span>
              <FieldTooltip text="When on, inflates Part B premiums, Part D national base, IRMAA bracket dollars, Medigap, and Part D plan premiums forward from the latest CMS-published year. Turn off to project Medicare costs in today's dollars. Historical Medicare inflation has run ~4-6%/yr; the conservative default is 3%." />
            </label>
            <div className="flex items-center gap-3">
              <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-2">
                <input
                  type="checkbox"
                  checked={medicareInflEnabled}
                  onChange={(e) => {
                    setMedicareInflEnabled(e.target.checked);
                    save({ medicarePremiumInflationEnabled: e.target.checked });
                  }}
                  className="h-3.5 w-3.5 rounded border-hair-2 bg-paper text-accent focus:ring-1 focus:ring-accent"
                />
                <span>On</span>
              </label>
              <div className="max-w-48">
                <PercentInput
                  id="medicarePremiumInflationRate"
                  value={values.medicarePremiumInflationRate}
                  placeholder="Defaults to 3.00%"
                  disabled={!medicareInflEnabled}
                  onChange={(raw) =>
                    update(
                      "medicarePremiumInflationRate",
                      raw,
                      // The column is non-nullable: a blank box means "keep the
                      // stored rate", which is what the toggle above turns off.
                      raw.trim() === "" ? undefined : toDecimal(raw),
                    )
                  }
                />
              </div>
            </div>
          </div>
        </div>
      </details>

      {resetError && (
        <p role="alert" className="rounded-[var(--radius-sm)] border border-crit/40 bg-crit/10 px-3 py-2 text-sm text-crit">
          {resetError}
        </p>
      )}
      {resetMessage && (
        <p className="rounded-[var(--radius-sm)] border border-good/40 bg-good/10 px-3 py-2 text-sm text-good">
          {resetMessage}
        </p>
      )}

      {canEdit && (
        <div className="flex justify-start pt-2">
          <button
            type="button"
            onClick={handleResetAccounts}
            disabled={resetting}
            className="rounded-[var(--radius-sm)] border border-hair-2 px-3 py-2 text-xs font-medium text-ink-2 hover:border-hair-3 hover:text-ink disabled:opacity-50"
            title="Clear account-level overrides and fall back to the category defaults above"
          >
            {resetting ? "Resetting..." : "Reset all accounts to defaults"}
          </button>
        </div>
      )}
      </fieldset>
    </div>
  );
}
