"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface PlanHorizonFormProps {
  clientId: string;
  planStartYear: number;
  planEndYear: number;
}

export default function PlanHorizonForm({ clientId, planStartYear, planEndYear }: PlanHorizonFormProps) {
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
      planStartYear: Number(data.get("planStartYear")),
      planEndYear: Number(data.get("planEndYear")),
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

      <header>
        <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-400">Plan Horizon</h3>
        <p className="mt-1 text-xs text-gray-500">The year range for the financial projection.</p>
      </header>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-400" htmlFor="planStartYear">Start year</label>
          <input
            id="planStartYear"
            name="planStartYear"
            type="number"
            min={2000}
            max={2100}
            defaultValue={planStartYear}
            className="mt-1 block w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400" htmlFor="planEndYear">End year</label>
          <input
            id="planEndYear"
            name="planEndYear"
            type="number"
            min={2000}
            max={2100}
            defaultValue={planEndYear}
            className="mt-1 block w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
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
