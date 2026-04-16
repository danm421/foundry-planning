"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface TaxRatesFormProps {
  clientId: string;
  flatFederalRate: string;
  flatStateRate: string;
  initialMode?: "flat" | "bracket";
}

const pct = (v: string) => (Number(v) * 100).toFixed(2);

export default function TaxRatesForm({ clientId, flatFederalRate, flatStateRate, initialMode = "flat" }: TaxRatesFormProps) {
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

    const body: Record<string, string | undefined> = {
      flatStateRate: toDec("flatStateRate"),
      taxEngineMode: mode,
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
        <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-400">Tax Rates</h3>
        <p className="mt-1 text-xs text-gray-500">Flat rates applied across the projection.</p>
      </header>

      <div className="mb-4">
        <label className="block text-xs font-medium text-gray-400 mb-2">Tax calculation method</label>
        <div className="inline-flex rounded-md bg-gray-800 p-1">
          <button
            type="button"
            onClick={() => setMode("flat")}
            className={`px-3 py-1.5 text-sm rounded ${mode === "flat" ? "bg-gray-700 text-white" : "text-gray-400"}`}
          >
            Flat rate
          </button>
          <button
            type="button"
            onClick={() => setMode("bracket")}
            className={`px-3 py-1.5 text-sm rounded ${mode === "bracket" ? "bg-gray-700 text-white" : "text-gray-400"}`}
          >
            Bracket-based
          </button>
        </div>
        <p className="mt-1 text-xs text-gray-500">
          Bracket mode uses progressive federal brackets, AMT, NIIT, and FICA based on filing status. Flat mode multiplies taxable income by your federal rate.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {mode === "flat" && (
          <div>
            <label className="block text-xs font-medium text-gray-400" htmlFor="flatFederalRate">Federal rate</label>
            <div className="relative mt-1">
              <input id="flatFederalRate" name="flatFederalRate" type="number" step="0.01" min={0} max={50} defaultValue={pct(flatFederalRate)} className="block w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 pr-8 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
              <span className="absolute inset-y-0 right-3 flex items-center text-xs text-gray-500">%</span>
            </div>
          </div>
        )}
        <div>
          <label className="block text-xs font-medium text-gray-400" htmlFor="flatStateRate">State rate</label>
          <div className="relative mt-1">
            <input id="flatStateRate" name="flatStateRate" type="number" step="0.01" min={0} max={20} defaultValue={pct(flatStateRate)} className="block w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 pr-8 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
            <span className="absolute inset-y-0 right-3 flex items-center text-xs text-gray-500">%</span>
          </div>
        </div>
      </div>

      <div className="flex justify-end pt-2">
        <button type="submit" disabled={loading} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
          {loading ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
