"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface GrowthInflationFormProps {
  clientId: string;
  inflationRate: string;
  defaultGrowthTaxable: string;
  defaultGrowthCash: string;
  defaultGrowthRetirement: string;
  defaultGrowthRealEstate: string;
  defaultGrowthBusiness: string;
  defaultGrowthLifeInsurance: string;
}

const GROWTH_FIELDS: {
  key: string;
  label: string;
  description: string;
}[] = [
  { key: "defaultGrowthTaxable", label: "Taxable", description: "Brokerage, trust, other taxable accounts" },
  { key: "defaultGrowthCash", label: "Cash", description: "Savings, checking, money-market" },
  { key: "defaultGrowthRetirement", label: "Retirement", description: "IRA, 401(k), Roth, 529" },
  { key: "defaultGrowthRealEstate", label: "Real Estate", description: "Residences and property" },
  { key: "defaultGrowthBusiness", label: "Business", description: "Ownership interests and entities" },
  { key: "defaultGrowthLifeInsurance", label: "Life Insurance", description: "Cash-value life policies" },
];

const pct = (v: string) => (Number(v) * 100).toFixed(2);

export default function GrowthInflationForm({ clientId, ...rates }: GrowthInflationFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(false);

    const data = new FormData(e.currentTarget);
    const toDec = (name: string) => String(Number(data.get(name) as string) / 100);

    const body = {
      inflationRate: toDec("inflationRate"),
      defaultGrowthTaxable: toDec("defaultGrowthTaxable"),
      defaultGrowthCash: toDec("defaultGrowthCash"),
      defaultGrowthRetirement: toDec("defaultGrowthRetirement"),
      defaultGrowthRealEstate: toDec("defaultGrowthRealEstate"),
      defaultGrowthBusiness: toDec("defaultGrowthBusiness"),
      defaultGrowthLifeInsurance: toDec("defaultGrowthLifeInsurance"),
    };

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
          <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-400">Inflation</h3>
          <p className="mt-1 text-xs text-gray-500">Annual inflation rate applied to expenses and incomes.</p>
        </header>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-400" htmlFor="inflationRate">Inflation rate</label>
            <div className="relative mt-1">
              <input id="inflationRate" name="inflationRate" type="number" step="0.01" min={0} max={20} defaultValue={pct(rates.inflationRate)} className="block w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 pr-8 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
              <span className="absolute inset-y-0 right-3 flex items-center text-xs text-gray-500">%</span>
            </div>
          </div>
        </div>
      </section>

      <section>
        <header className="mb-3">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-400">Default Growth Rates</h3>
          <p className="mt-1 text-xs text-gray-500">Applied to every account of the given category unless that account specifies its own growth rate.</p>
        </header>

        <div className="divide-y divide-gray-800 rounded-md border border-gray-800 bg-gray-900/60">
          {GROWTH_FIELDS.map((field) => (
            <div key={field.key} className="flex items-center justify-between gap-6 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-100">{field.label}</p>
                <p className="text-xs text-gray-500">{field.description}</p>
              </div>
              <div className="relative w-28 flex-shrink-0">
                <input
                  id={field.key}
                  name={field.key}
                  type="number"
                  step="0.01"
                  min={0}
                  max={30}
                  defaultValue={pct((rates as Record<string, string>)[field.key])}
                  className="block w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 pr-8 text-right text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-gray-500">%</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="flex justify-end pt-2">
        <button type="submit" disabled={loading} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
          {loading ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
