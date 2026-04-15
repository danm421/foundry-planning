"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface AddAccountFormProps {
  clientId: string;
  category?: "taxable" | "cash" | "retirement";
  onSuccess?: () => void;
}

const SUB_TYPE_BY_CATEGORY = {
  taxable: ["brokerage", "trust", "other"],
  cash: ["savings", "checking", "other"],
  retirement: ["traditional_ira", "roth_ira", "401k", "roth_401k", "529", "other"],
};

const SUB_TYPE_LABELS: Record<string, string> = {
  brokerage: "Brokerage",
  savings: "Savings",
  checking: "Checking",
  traditional_ira: "Traditional IRA",
  roth_ira: "Roth IRA",
  "401k": "401(k)",
  roth_401k: "Roth 401(k)",
  "529": "529 Plan",
  trust: "Trust",
  other: "Other",
};

export default function AddAccountForm({ clientId, category: defaultCategory, onSuccess }: AddAccountFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<"taxable" | "cash" | "retirement">(defaultCategory ?? "taxable");

  const subTypes = SUB_TYPE_BY_CATEGORY[category];

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const form = e.currentTarget;
    const data = new FormData(form);

    const body = {
      name: data.get("name") as string,
      category: data.get("category") as string,
      subType: data.get("subType") as string,
      owner: data.get("owner") as string,
      value: data.get("value") as string,
      basis: data.get("basis") as string,
      growthRate: data.get("growthRate") as string,
    };

    try {
      const res = await fetch(`/api/clients/${clientId}/accounts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? "Failed to create account");
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
          Account Name <span className="text-red-500">*</span>
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          placeholder="e.g., Fidelity Brokerage"
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700" htmlFor="category">
            Category <span className="text-red-500">*</span>
          </label>
          <select
            id="category"
            name="category"
            required
            value={category}
            onChange={(e) => setCategory(e.target.value as "taxable" | "cash" | "retirement")}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="taxable">Taxable</option>
            <option value="cash">Cash</option>
            <option value="retirement">Retirement</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700" htmlFor="subType">
            Account Type
          </label>
          <select
            id="subType"
            name="subType"
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {subTypes.map((t) => (
              <option key={t} value={t}>
                {SUB_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700" htmlFor="owner">
            Owner
          </label>
          <select
            id="owner"
            name="owner"
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="client">Client</option>
            <option value="spouse">Spouse</option>
            <option value="joint">Joint</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700" htmlFor="growthRate">
            Growth Rate (%)
          </label>
          <input
            id="growthRate"
            name="growthRate"
            type="number"
            step="0.01"
            min={0}
            max={30}
            defaultValue={7}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700" htmlFor="value">
            Current Value ($)
          </label>
          <input
            id="value"
            name="value"
            type="number"
            step="0.01"
            min={0}
            defaultValue={0}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700" htmlFor="basis">
            Cost Basis ($)
          </label>
          <input
            id="basis"
            name="basis"
            type="number"
            step="0.01"
            min={0}
            defaultValue={0}
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
          {loading ? "Adding..." : "Add Account"}
        </button>
      </div>
    </form>
  );
}
