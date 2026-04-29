"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface PlanSettingsFormProps {
  clientId: string;
  initialSettings: {
    flatFederalRate: string;
    flatStateRate: string;
    inflationRate: string;
    planStartYear: number;
    planEndYear: number;
  };
}

export default function PlanSettingsForm({ clientId, initialSettings }: PlanSettingsFormProps) {
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

    const body = {
      flatFederalRate: String(Number(data.get("flatFederalRate") as string) / 100),
      flatStateRate: String(Number(data.get("flatStateRate") as string) / 100),
      inflationRate: String(Number(data.get("inflationRate") as string) / 100),
      planStartYear: Number(data.get("planStartYear") as string),
      planEndYear: Number(data.get("planEndYear") as string),
    };

    try {
      const res = await fetch(`/api/clients/${clientId}/plan-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? "Failed to update settings");
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
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <p className="rounded bg-red-900/50 px-3 py-2 text-sm text-red-400">{error}</p>
      )}
      {success && (
        <p className="rounded bg-green-900/50 px-3 py-2 text-sm text-green-400">Settings saved successfully.</p>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-300" htmlFor="flatFederalRate">
            Flat Federal Tax Rate (%)
          </label>
          <input
            id="flatFederalRate"
            name="flatFederalRate"
            type="number"
            step="0.01"
            min={0}
            max={50}
            defaultValue={(Number(initialSettings.flatFederalRate) * 100).toFixed(2)}
            className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300" htmlFor="flatStateRate">
            Flat State Tax Rate (%)
          </label>
          <input
            id="flatStateRate"
            name="flatStateRate"
            type="number"
            step="0.01"
            min={0}
            max={20}
            defaultValue={(Number(initialSettings.flatStateRate) * 100).toFixed(2)}
            className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300" htmlFor="inflationRate">
            Inflation Rate (%)
          </label>
          <input
            id="inflationRate"
            name="inflationRate"
            type="number"
            step="0.01"
            min={0}
            max={20}
            defaultValue={(Number(initialSettings.inflationRate) * 100).toFixed(2)}
            className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>

        <div>{/* spacer */}</div>

        <div>
          <label className="block text-sm font-medium text-gray-300" htmlFor="planStartYear">
            Plan Start Year
          </label>
          <input
            id="planStartYear"
            name="planStartYear"
            type="number"
            min={2000}
            max={2100}
            defaultValue={initialSettings.planStartYear}
            className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300" htmlFor="planEndYear">
            Plan End Year
          </label>
          <input
            id="planEndYear"
            name="planEndYear"
            type="number"
            min={2000}
            max={2100}
            defaultValue={initialSettings.planEndYear}
            className="mt-1 block w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
      </div>

      <div className="flex justify-end pt-2">
        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-on hover:bg-accent-deep disabled:opacity-50"
        >
          {loading ? "Saving..." : "Save Settings"}
        </button>
      </div>
    </form>
  );
}
