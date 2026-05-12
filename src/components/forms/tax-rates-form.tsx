"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PercentInput } from "@/components/percent-input";
import { STATE_ESTATE_TAX, type Bracket } from "@/lib/tax/state-estate";
import { USPS_STATE_NAMES, USPS_STATE_CODES, type USPSStateCode } from "@/lib/usps-states";

interface TaxRatesFormProps {
  clientId: string;
  flatFederalRate: string;
  flatStateRate: string;
  estateAdminExpenses: string;
  flatStateEstateRate: string;
  residenceState: USPSStateCode | null;
  irdTaxRate: string;
  outOfHouseholdDniRate: string;
  priorTaxableGiftsClient: string;
  priorTaxableGiftsSpouse: string;
  hasSpouse: boolean;
  clientFirstName?: string;
  spouseFirstName?: string;
  initialMode?: "flat" | "bracket";
}

const pct = (v: string) => (Number(v) * 100).toFixed(2);

function topRate(brackets: Bracket[]): number {
  return brackets.reduce((m, b) => Math.max(m, b.rate), 0);
}

const INHERITANCE_TAX_STATES = new Set(["PA", "NJ", "KY", "NE", "MD"]);

const STATE_OPTIONS = USPS_STATE_CODES
  .map((code) => {
    const name = USPS_STATE_NAMES[code];
    const estateRule = (STATE_ESTATE_TAX as Record<string, { exemption: number; brackets: Bracket[] } | undefined>)[code];
    const hasInheritance = INHERITANCE_TAX_STATES.has(code);
    let suffix: string;
    if (estateRule && hasInheritance) {
      suffix = `$${(estateRule.exemption / 1_000_000).toFixed(2)}M exemption · top ${Math.round(topRate(estateRule.brackets) * 100)}% · inheritance tax`;
    } else if (estateRule) {
      suffix = `$${(estateRule.exemption / 1_000_000).toFixed(2)}M exemption · top ${Math.round(topRate(estateRule.brackets) * 100)}%`;
    } else if (hasInheritance) {
      suffix = "inheritance tax only";
    } else {
      suffix = "no state estate or inheritance tax";
    }
    return { code, label: `${name} — ${suffix}` };
  })
  .sort((a, b) => a.label.localeCompare(b.label));

export default function TaxRatesForm({
  clientId,
  flatFederalRate,
  flatStateRate,
  estateAdminExpenses,
  flatStateEstateRate,
  residenceState,
  irdTaxRate,
  outOfHouseholdDniRate,
  priorTaxableGiftsClient,
  priorTaxableGiftsSpouse,
  hasSpouse,
  clientFirstName,
  spouseFirstName,
  initialMode = "flat",
}: TaxRatesFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [mode, setMode] = useState<"flat" | "bracket">(initialMode);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(false);

    const data = new FormData(e.currentTarget);
    const toDec = (name: string) => String(Number(data.get(name) as string) / 100);

    const rawResidence = data.get("residenceState");
    const residence = typeof rawResidence === "string" && rawResidence.length === 2
      ? rawResidence
      : null;
    const body: Record<string, string | null | undefined> = {
      flatStateRate: toDec("flatStateRate"),
      taxEngineMode: mode,
      estateAdminExpenses: String(Number(data.get("estateAdminExpenses") ?? "0")),
      flatStateEstateRate: String(Number(data.get("flatStateEstateRate") ?? "0") / 100),
      residenceState: residence,
      irdTaxRate: String(Number(data.get("irdTaxRate") ?? "0") / 100),
      outOfHouseholdDniRate: String(Number(data.get("outOfHouseholdDniRate") ?? "0") / 100),
      priorTaxableGiftsClient: String(Number(data.get("priorTaxableGiftsClient") ?? "0")),
      priorTaxableGiftsSpouse: hasSpouse
        ? String(Number(data.get("priorTaxableGiftsSpouse") ?? "0"))
        : "0",
    };

    if (mode === "flat") {
      body.flatFederalRate = toDec("flatFederalRate");
    }

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

      <header>
        <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-300">Income Tax</h3>
        <p className="mt-1 text-xs text-gray-400">Flat rates applied across the projection.</p>
      </header>

      <div className="mb-4">
        <label className="block text-xs font-medium text-gray-300 mb-2">Tax calculation method</label>
        <div className="inline-flex rounded-md bg-gray-800 p-1">
          <button
            type="button"
            onClick={() => setMode("flat")}
            className={`px-3 py-1.5 text-sm rounded ${mode === "flat" ? "bg-gray-700 text-white" : "text-gray-300"}`}
          >
            Flat rate
          </button>
          <button
            type="button"
            onClick={() => setMode("bracket")}
            className={`px-3 py-1.5 text-sm rounded ${mode === "bracket" ? "bg-gray-700 text-white" : "text-gray-300"}`}
          >
            Bracket-based
          </button>
        </div>
        <p className="mt-1 text-xs text-gray-400">
          Bracket mode uses progressive federal brackets, AMT, NIIT, and FICA based on filing status. Flat mode multiplies taxable income by your federal rate.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {mode === "flat" && (
          <div>
            <label className="block text-xs font-medium text-gray-300" htmlFor="flatFederalRate">Federal rate</label>
            <PercentInput id="flatFederalRate" name="flatFederalRate" defaultValue={pct(flatFederalRate)} className="mt-1 block w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
          </div>
        )}
        <div>
          <label className="block text-xs font-medium text-gray-300" htmlFor="flatStateRate">State rate</label>
          <PercentInput id="flatStateRate" name="flatStateRate" defaultValue={pct(flatStateRate)} className="mt-1 block w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />
        </div>
      </div>

      <header className="mt-6">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-300">Estate Tax</h3>
        <p className="mt-1 text-xs text-gray-400">Applied at each death event in the projection.</p>
      </header>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-300" htmlFor="estateAdminExpenses">Estate administrative expenses ($)</label>
          <input
            id="estateAdminExpenses"
            name="estateAdminExpenses"
            type="number"
            min="0"
            step="100"
            defaultValue={estateAdminExpenses}
            className="mt-1 block w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-300" htmlFor="residenceState">State of residence (for estate &amp; inheritance tax)</label>
          <select
            id="residenceState"
            name="residenceState"
            defaultValue={residenceState ?? ""}
            className="mt-1 block w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <option value="">— Not set —</option>
            {STATE_OPTIONS.map((s) => (
              <option key={s.code} value={s.code}>
                {s.label}
              </option>
            ))}
          </select>
          <details className="mt-2 text-xs text-gray-400">
            <summary className="cursor-pointer">Custom flat rate (override)</summary>
            <div className="mt-2">
              <label className="block text-xs font-medium text-gray-300" htmlFor="flatStateEstateRate">
                Override rate (applied when no state is selected)
              </label>
              <PercentInput
                id="flatStateEstateRate"
                name="flatStateEstateRate"
                defaultValue={pct(flatStateEstateRate)}
                className="mt-1 block w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
          </details>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-300" htmlFor="irdTaxRate">IRD tax rate</label>
          <PercentInput
            id="irdTaxRate"
            name="irdTaxRate"
            defaultValue={pct(irdTaxRate)}
            className="mt-1 block w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <p className="mt-1 text-xs text-gray-400">
            Applied to pre-tax retirement assets (traditional IRA, 401(k), 403(b)) passing to a non-spouse, non-charity beneficiary at death.
          </p>
        </div>
      </div>

      <header className="mt-6">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-300">Trust Tax</h3>
        <p className="mt-1 text-xs text-gray-400">Applied when a non-grantor trust distributes income to a beneficiary outside the household.</p>
      </header>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-300" htmlFor="outOfHouseholdDniRate">Out-of-household DNI tax rate</label>
          <PercentInput
            id="outOfHouseholdDniRate"
            name="outOfHouseholdDniRate"
            defaultValue={pct(outOfHouseholdDniRate)}
            className="mt-1 block w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <p className="mt-1 text-xs text-gray-400">Records an estimated recipient-side tax in the plan&apos;s tax summary. Defaults to top federal bracket (37%).</p>
        </div>
      </div>

      <header className="mt-6">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-300">Prior lifetime gifts</h3>
        <p className="mt-1 text-xs text-gray-400">
          Post-1976 cumulative taxable gifts before plan start. Pull from the most recent Form 709&apos;s &ldquo;prior periods&rdquo; line.
          Joint pre-plan gifts are pre-attributed (e.g. a $200K joint gift = $100K on each spouse).
        </p>
      </header>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-300" htmlFor="priorTaxableGiftsClient">
            {clientFirstName ?? "Client"} ($)
          </label>
          <input
            id="priorTaxableGiftsClient"
            name="priorTaxableGiftsClient"
            type="number"
            min="0"
            step="1000"
            defaultValue={priorTaxableGiftsClient}
            className="mt-1 block w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
        {hasSpouse && (
          <div>
            <label className="block text-xs font-medium text-gray-300" htmlFor="priorTaxableGiftsSpouse">
              {spouseFirstName ?? "Spouse"} ($)
            </label>
            <input
              id="priorTaxableGiftsSpouse"
              name="priorTaxableGiftsSpouse"
              type="number"
              min="0"
              step="1000"
              defaultValue={priorTaxableGiftsSpouse}
              className="mt-1 block w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
        )}
      </div>

      <div className="flex justify-end pt-2">
        <button type="submit" disabled={loading} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-on hover:bg-accent-deep disabled:opacity-50">
          {loading ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
