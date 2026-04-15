"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type AccountCategory = "taxable" | "cash" | "retirement" | "real_estate" | "business" | "life_insurance";

interface AddAccountFormProps {
  clientId: string;
  category?: AccountCategory;
  onSuccess?: () => void;
}

const SUB_TYPE_BY_CATEGORY: Record<AccountCategory, string[]> = {
  taxable: ["brokerage", "trust", "other"],
  cash: ["savings", "checking", "other"],
  retirement: ["traditional_ira", "roth_ira", "401k", "roth_401k", "529", "other"],
  real_estate: ["primary_residence", "rental_property", "commercial_property"],
  business: ["sole_proprietorship", "partnership", "s_corp", "c_corp", "llc"],
  life_insurance: ["term", "whole_life", "universal_life", "variable_life"],
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
  primary_residence: "Primary Residence",
  rental_property: "Rental Property",
  commercial_property: "Commercial Property",
  sole_proprietorship: "Sole Proprietorship",
  partnership: "Partnership",
  s_corp: "S Corp",
  c_corp: "C Corp",
  llc: "LLC",
  term: "Term Life",
  whole_life: "Whole Life",
  universal_life: "Universal Life",
  variable_life: "Variable Life",
};

const CATEGORY_LABELS: Record<AccountCategory, string> = {
  taxable: "Taxable",
  cash: "Cash",
  retirement: "Retirement",
  real_estate: "Real Estate",
  business: "Business",
  life_insurance: "Life Insurance",
};

const RETIREMENT_SUB_TYPES = new Set(["traditional_ira", "roth_ira", "401k", "roth_401k", "529"]);

export default function AddAccountForm({ clientId, category: defaultCategory, onSuccess }: AddAccountFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<AccountCategory>(defaultCategory ?? "taxable");
  const [activeTab, setActiveTab] = useState<"details" | "savings">("details");
  const [subType, setSubType] = useState(SUB_TYPE_BY_CATEGORY[defaultCategory ?? "taxable"][0]);

  const currentYear = new Date().getFullYear();
  const subTypes = SUB_TYPE_BY_CATEGORY[category];
  const isRetirementAccount = category === "retirement" && RETIREMENT_SUB_TYPES.has(subType);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const form = e.currentTarget;
    const data = new FormData(form);

    const accountBody = {
      name: data.get("name") as string,
      category: data.get("category") as string,
      subType: data.get("subType") as string,
      owner: data.get("owner") as string,
      value: data.get("value") as string,
      basis: data.get("basis") as string,
      growthRate: data.get("growthRate") as string,
    };

    // Savings tab data
    const savingsAmount = data.get("savingsAmount") as string;
    const hasSavings = savingsAmount && Number(savingsAmount) > 0;

    try {
      const res = await fetch(`/api/clients/${clientId}/accounts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(accountBody),
      });

      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? "Failed to create account");
      }

      const account = await res.json();

      // Create savings rule if savings tab was filled
      if (hasSavings) {
        const matchPct = data.get("employerMatchPct") as string;
        const matchCap = data.get("employerMatchCap") as string;
        const limit = data.get("annualLimit") as string;

        const savingsBody = {
          accountId: account.id,
          annualAmount: savingsAmount,
          startYear: data.get("savingsStartYear") as string,
          endYear: data.get("savingsEndYear") as string,
          employerMatchPct: matchPct ? String(Number(matchPct) / 100) : null,
          employerMatchCap: matchCap ? String(Number(matchCap) / 100) : null,
          annualLimit: limit || null,
        };

        const savingsRes = await fetch(`/api/clients/${clientId}/savings-rules`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(savingsBody),
        });

        if (!savingsRes.ok) {
          // Account was created but savings rule failed — still refresh
          console.error("Failed to create savings rule");
        }
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

      {/* Tab bar */}
      <div className="flex border-b border-gray-200">
        <button
          type="button"
          onClick={() => setActiveTab("details")}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
            activeTab === "details"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          Account Details
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("savings")}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
            activeTab === "savings"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          Savings
        </button>
      </div>

      {/* Account Details tab */}
      <div className={activeTab === "details" ? "" : "hidden"}>
        <div className="space-y-4">
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
                onChange={(e) => {
                  const newCat = e.target.value as AccountCategory;
                  setCategory(newCat);
                  setSubType(SUB_TYPE_BY_CATEGORY[newCat][0]);
                }}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {(Object.keys(CATEGORY_LABELS) as AccountCategory[]).map((cat) => (
                  <option key={cat} value={cat}>{CATEGORY_LABELS[cat]}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700" htmlFor="subType">
                Account Type
              </label>
              <select
                id="subType"
                name="subType"
                value={subType}
                onChange={(e) => setSubType(e.target.value)}
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
        </div>
      </div>

      {/* Savings tab */}
      <div className={activeTab === "savings" ? "" : "hidden"}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700" htmlFor="savingsAmount">
                Annual Contribution ($)
              </label>
              <input
                id="savingsAmount"
                name="savingsAmount"
                type="number"
                step="1"
                min={0}
                defaultValue={0}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700" htmlFor="annualLimit">
                Annual Limit ($)
              </label>
              <input
                id="annualLimit"
                name="annualLimit"
                type="number"
                step="1"
                min={0}
                placeholder="Optional"
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700" htmlFor="savingsStartYear">
                Start Year
              </label>
              <input
                id="savingsStartYear"
                name="savingsStartYear"
                type="number"
                defaultValue={currentYear}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700" htmlFor="savingsEndYear">
                End Year
              </label>
              <input
                id="savingsEndYear"
                name="savingsEndYear"
                type="number"
                defaultValue={currentYear + 20}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>

          {isRetirementAccount && (
            <div className="grid grid-cols-2 gap-4 border-t border-gray-200 pt-4">
              <p className="col-span-2 text-xs font-medium uppercase tracking-wider text-gray-400">Employer Match</p>
              <div>
                <label className="block text-sm font-medium text-gray-700" htmlFor="employerMatchPct">
                  Match Rate (%)
                </label>
                <input
                  id="employerMatchPct"
                  name="employerMatchPct"
                  type="number"
                  step="1"
                  min={0}
                  max={100}
                  placeholder="e.g., 50"
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700" htmlFor="employerMatchCap">
                  Match Cap (% of salary)
                </label>
                <input
                  id="employerMatchCap"
                  name="employerMatchCap"
                  type="number"
                  step="0.1"
                  min={0}
                  max={100}
                  placeholder="e.g., 6"
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>
          )}
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
