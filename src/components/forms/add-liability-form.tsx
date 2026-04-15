"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface AddLiabilityFormProps {
  clientId: string;
  realEstateAccounts?: { id: string; name: string }[];
  onSuccess?: () => void;
}

export default function AddLiabilityForm({ clientId, realEstateAccounts, onSuccess }: AddLiabilityFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentYear = new Date().getFullYear();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const form = e.currentTarget;
    const data = new FormData(form);

    const linkedPropertyId = data.get("linkedPropertyId") as string;

    const body = {
      name: data.get("name") as string,
      balance: data.get("balance") as string,
      interestRate: data.get("interestRate") as string,
      monthlyPayment: data.get("monthlyPayment") as string,
      startYear: Number(data.get("startYear")),
      endYear: Number(data.get("endYear")),
      linkedPropertyId: linkedPropertyId || null,
    };

    try {
      const res = await fetch(`/api/clients/${clientId}/liabilities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? "Failed to create liability");
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
        <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700" htmlFor="name">
          Liability Name <span className="text-red-500">*</span>
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          placeholder="e.g., Primary Mortgage"
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700" htmlFor="balance">
            Outstanding Balance ($)
          </label>
          <input
            id="balance"
            name="balance"
            type="number"
            step="0.01"
            min={0}
            defaultValue={0}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700" htmlFor="interestRate">
            Interest Rate (%)
          </label>
          <input
            id="interestRate"
            name="interestRate"
            type="number"
            step="0.01"
            min={0}
            max={50}
            defaultValue={0}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700" htmlFor="monthlyPayment">
            Monthly Payment ($)
          </label>
          <input
            id="monthlyPayment"
            name="monthlyPayment"
            type="number"
            step="0.01"
            min={0}
            defaultValue={0}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {realEstateAccounts && realEstateAccounts.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-gray-700" htmlFor="linkedPropertyId">
              Linked Property
            </label>
            <select
              id="linkedPropertyId"
              name="linkedPropertyId"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">None</option>
              {realEstateAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700" htmlFor="startYear">
            Start Year <span className="text-red-500">*</span>
          </label>
          <input
            id="startYear"
            name="startYear"
            type="number"
            required
            defaultValue={currentYear}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700" htmlFor="endYear">
            End Year <span className="text-red-500">*</span>
          </label>
          <input
            id="endYear"
            name="endYear"
            type="number"
            required
            defaultValue={currentYear + 30}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>

      <div className="flex justify-end pt-2">
        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Adding..." : "Add Liability"}
        </button>
      </div>
    </form>
  );
}
