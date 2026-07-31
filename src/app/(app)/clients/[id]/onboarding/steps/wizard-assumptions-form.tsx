"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PercentInput } from "@/components/percent-input";
import { FieldTooltip } from "@/components/forms/field-tooltip";
import { useClientAccess } from "@/components/client-access-provider";
import { inputBaseClassName, selectClassName } from "@/components/forms/input-styles";
import { USPS_STATE_CODES, USPS_STATE_NAMES, type USPSStateCode } from "@/lib/usps-states";
import { STATE_ESTATE_TAX, INHERITANCE_TAX_STATES } from "@/lib/tax/state-estate";

/** The plan-settings subset this step owns. Key names mirror the
 *  `plan-settings` PUT body so the server component can fill it straight from
 *  the row without an adapter. */
export interface WizardAssumptionsSettings {
  residenceState: USPSStateCode | null;
  defaultGrowthTaxable: string;
  defaultGrowthRetirement: string;
  defaultGrowthCash: string;
  growthSourceTaxable: string;
  growthSourceRetirement: string;
  growthSourceCash: string;
  modelPortfolioIdTaxable: string | null;
  modelPortfolioIdRetirement: string | null;
  modelPortfolioIdCash: string | null;
  surplusSpendPct: string;
  surplusSaveAccountId: string | null;
}

interface ModelPortfolioOption {
  id: string;
  name: string;
  blendedReturn: number;
}

interface WizardAssumptionsFormProps {
  clientId: string;
  settings: WizardAssumptionsSettings;
  modelPortfolios: ModelPortfolioOption[];
  householdAccounts: { id: string; name: string }[];
  resolvedInflationRate: number;
}

/** Investable categories, in the order the wizard presents them. `asset_mix`
 *  is offered on Taxable and Retirement only — matching the details page,
 *  where Cash has no per-account mix to fall back on. */
const GROWTH_ROWS = [
  {
    category: "taxable",
    label: "Taxable",
    help: "Applies to every brokerage, trust, and other taxable account that has no growth rate of its own.",
    rateKey: "defaultGrowthTaxable",
    sourceKey: "growthSourceTaxable",
    portfolioKey: "modelPortfolioIdTaxable",
    allowAssetMix: true,
  },
  {
    category: "retirement",
    label: "Retirement",
    help: "Applies to every IRA, 401(k), Roth, and 529 that has no growth rate of its own.",
    rateKey: "defaultGrowthRetirement",
    sourceKey: "growthSourceRetirement",
    portfolioKey: "modelPortfolioIdRetirement",
    allowAssetMix: true,
  },
  {
    category: "cash",
    label: "Cash",
    help: "Applies to every savings, checking, and money-market account that has no growth rate of its own.",
    rateKey: "defaultGrowthCash",
    sourceKey: "growthSourceCash",
    portfolioKey: "modelPortfolioIdCash",
    allowAssetMix: false,
  },
] as const;

const pct = (v: string) => (Number(v) * 100).toFixed(2);

function Section({
  title,
  help,
  intro,
  children,
}: {
  title: string;
  help: string;
  intro: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[var(--radius-sm)] border border-hair bg-card-2/40 p-4">
      <div className="flex items-center gap-1.5">
        <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
        <FieldTooltip text={help} />
      </div>
      <p className="mt-1 text-[13px] leading-snug text-ink-3">{intro}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default function WizardAssumptionsForm({
  clientId,
  settings,
  modelPortfolios,
  householdAccounts,
  resolvedInflationRate,
}: WizardAssumptionsFormProps) {
  const { permission } = useClientAccess();
  const canEdit = permission === "edit";
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [residence, setResidence] = useState<USPSStateCode | "">(
    settings.residenceState ?? "",
  );

  const [sources, setSources] = useState<Record<string, { source: string; portfolioId: string }>>({
    taxable: {
      source: settings.growthSourceTaxable || "custom",
      portfolioId: settings.modelPortfolioIdTaxable ?? "",
    },
    retirement: {
      source: settings.growthSourceRetirement || "custom",
      portfolioId: settings.modelPortfolioIdRetirement ?? "",
    },
    cash: {
      source: settings.growthSourceCash || "custom",
      portfolioId: settings.modelPortfolioIdCash ?? "",
    },
  });

  function setSource(category: string, value: string) {
    if (value.startsWith("mp:")) {
      setSources((p) => ({
        ...p,
        [category]: { source: "model_portfolio", portfolioId: value.slice(3) },
      }));
    } else {
      setSources((p) => ({ ...p, [category]: { source: value, portfolioId: "" } }));
    }
  }

  const estateRule =
    residence && residence in STATE_ESTATE_TAX
      ? STATE_ESTATE_TAX[residence as keyof typeof STATE_ESTATE_TAX]
      : null;
  const hasInheritanceTax = residence !== "" && INHERITANCE_TAX_STATES.has(residence);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(false);

    const data = new FormData(e.currentTarget);
    const toDec = (name: string) => String(Number(data.get(name) as string) / 100);

    const body: Record<string, unknown> = {
      residenceState: residence === "" ? null : residence,
      surplusSpendPct: toDec("surplusSpendPct"),
      surplusSaveAccountId: (data.get("surplusSaveAccountId") as string) || null,
    };
    for (const row of GROWTH_ROWS) {
      const s = sources[row.category];
      body[row.sourceKey] = s.source;
      body[row.portfolioKey] = s.source === "model_portfolio" ? s.portfolioId : null;
      body[row.rateKey] = toDec(row.rateKey);
    }

    try {
      const res = await fetch(`/api/clients/${clientId}/plan-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? "Failed to save");
      }
      // Bookkeeping only — the settings write above is what matters, so a
      // failure here must not surface as a failed save.
      try {
        await fetch(`/api/clients/${clientId}/onboarding`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ assumptionsReviewed: true }),
        });
      } catch {
        // no-op
      }
      setSuccess(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  const rateCls = `${inputBaseClassName} tabular w-28 text-right`;
  const ROW_GRID =
    "grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_8rem] items-center gap-3 px-3";

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <p
          role="alert"
          className="rounded-[var(--radius-sm)] border border-crit/30 bg-crit/10 px-3 py-2 text-[13px] text-crit"
        >
          {error}
        </p>
      )}
      {success && (
        <p className="rounded-[var(--radius-sm)] border border-accent/30 bg-accent/10 px-3 py-2 text-[13px] text-accent-ink">
          Saved.
        </p>
      )}

      <fieldset disabled={!canEdit} className="m-0 space-y-5 border-0 p-0">
        <Section
          title="State of residence"
          help="Drives both engines: the income-tax engine uses this state's brackets and deductions, and the estate-tax engine uses its estate or inheritance rules."
          intro="Where this household lives, for income and estate tax."
        >
          <div className="max-w-sm">
            <label
              htmlFor="residenceState"
              className="mb-1.5 block text-[13px] font-medium text-ink-2"
            >
              State of residence
            </label>
            <select
              id="residenceState"
              value={residence}
              onChange={(e) =>
                setResidence(e.target.value === "" ? "" : (e.target.value as USPSStateCode))
              }
              className={selectClassName}
            >
              <option value="">— Not set —</option>
              {USPS_STATE_CODES.map((code) => (
                <option key={code} value={code}>
                  {USPS_STATE_NAMES[code]}
                </option>
              ))}
            </select>
            {(estateRule || hasInheritanceTax) && (
              <p
                data-testid="estate-note"
                className="mt-2 text-[12px] leading-snug text-ink-3"
              >
                {estateRule && (
                  <>
                    {USPS_STATE_NAMES[residence as USPSStateCode]} levies a state estate tax —{" "}
                    <span className="tabular">
                      ${(estateRule.exemption / 1_000_000).toFixed(2)}M
                    </span>{" "}
                    exemption, top rate{" "}
                    <span className="tabular">
                      {Math.round(Math.max(...estateRule.brackets.map((b) => b.rate)) * 100)}%
                    </span>
                    .
                  </>
                )}
                {estateRule && hasInheritanceTax && " "}
                {hasInheritanceTax && "Heirs may also owe state inheritance tax."}
              </p>
            )}
          </div>
        </Section>

        <Section
          title="Default growth rates"
          help="Applied to every account in the category that does not carry a growth rate of its own. Account-level rates always win."
          intro="How the accounts grow each year, unless an account says otherwise."
        >
          <div className="overflow-hidden rounded-[var(--radius-sm)] border border-hair">
            <div
              className={`${ROW_GRID} border-b border-hair bg-card-2 py-2 text-[11px] font-medium uppercase tracking-wider text-ink-4`}
            >
              <span>Category</span>
              <span>Source</span>
              <span className="text-right">Rate</span>
            </div>
            <div className="divide-y divide-hair">
              {GROWTH_ROWS.map((row) => {
                const s = sources[row.category];
                const selectVal =
                  s.source === "model_portfolio" ? `mp:${s.portfolioId}` : s.source;
                const storedRate = pct(
                  (settings as unknown as Record<string, string>)[row.rateKey],
                );
                return (
                  <div
                    key={row.category}
                    data-testid="growth-row"
                    data-category={row.category}
                    className={`${ROW_GRID} py-2.5`}
                  >
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-[14px] font-medium text-ink">
                        {row.label}
                      </span>
                      <FieldTooltip text={row.help} />
                    </div>
                    <select
                      data-testid={`growth-source-${row.category}`}
                      aria-label={`${row.label} growth source`}
                      value={selectVal}
                      onChange={(e) => setSource(row.category, e.target.value)}
                      className={selectClassName}
                    >
                      {modelPortfolios.map((mp) => (
                        <option key={mp.id} value={`mp:${mp.id}`}>
                          {mp.name} ({(mp.blendedReturn * 100).toFixed(2)}%)
                        </option>
                      ))}
                      <option value="inflation">
                        Inflation ({(resolvedInflationRate * 100).toFixed(2)}%)
                      </option>
                      <option value="custom">Custom %</option>
                      {row.allowAssetMix && (
                        <option value="asset_mix">Asset mix (per account)</option>
                      )}
                    </select>
                    <div className="justify-self-end">
                      {s.source === "custom" ? (
                        <PercentInput
                          name={row.rateKey}
                          aria-label={`${row.label} growth rate`}
                          defaultValue={storedRate}
                          className={rateCls}
                        />
                      ) : (
                        <>
                          <span className="block w-28 px-1 text-right text-[12px] text-ink-4">
                            —
                          </span>
                          <input
                            type="hidden"
                            name={row.rateKey}
                            value={storedRate}
                          />
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </Section>

        <Section
          title="Surplus cash flow"
          help="Applied to any positive net cash flow left after savings, gifts, and taxes. The spent portion shows as 'Surplus spent' on the Cash Flow report; the rest lands in the account below."
          intro="What happens to money left over at the end of each year."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="surplusSpendPct"
                className="mb-1.5 block text-[13px] font-medium text-ink-2"
              >
                Spend this much of it
              </label>
              <PercentInput
                id="surplusSpendPct"
                name="surplusSpendPct"
                defaultValue={pct(settings.surplusSpendPct)}
                className={`${inputBaseClassName} tabular w-full text-right`}
              />
            </div>
            <div>
              <label
                htmlFor="surplusSaveAccountId"
                className="mb-1.5 block text-[13px] font-medium text-ink-2"
              >
                Put the rest into
              </label>
              <select
                id="surplusSaveAccountId"
                name="surplusSaveAccountId"
                defaultValue={settings.surplusSaveAccountId ?? ""}
                className={selectClassName}
              >
                <option value="">Household checking (default)</option>
                {householdAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </Section>

        {canEdit && (
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={loading}
              className="h-9 rounded-[var(--radius-sm)] bg-accent px-4 text-[13px] font-semibold text-accent-on transition-colors hover:bg-accent-ink disabled:opacity-60"
            >
              {loading ? "Saving…" : "Save"}
            </button>
          </div>
        )}
      </fieldset>
    </form>
  );
}
