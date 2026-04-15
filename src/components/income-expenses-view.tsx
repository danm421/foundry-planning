"use client";

import { useState } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

type IncomeType = "salary" | "social_security" | "business" | "deferred" | "capital_gains" | "trust" | "other";
type ExpenseType = "living" | "other" | "insurance";
type Owner = "client" | "spouse" | "joint";

interface Income {
  id: string;
  type: IncomeType;
  name: string;
  annualAmount: string;
  startYear: number;
  endYear: number;
  owner: Owner;
  claimingAge: number | null;
  linkedEntityId: string | null;
  growthRate: string;
}

interface Expense {
  id: string;
  type: ExpenseType;
  name: string;
  annualAmount: string;
  startYear: number;
  endYear: number;
  growthRate: string;
}

interface SavingsRule {
  id: string;
  accountId: string;
  annualAmount: string;
  startYear: number;
  endYear: number;
  employerMatchPct: string | null;
  employerMatchCap: string | null;
  annualLimit: string | null;
}

interface WithdrawalStrategy {
  id: string;
  accountId: string;
  priorityOrder: number;
  startYear: number;
  endYear: number;
}

interface Account {
  id: string;
  name: string;
  category: string;
  subType: string;
}

interface IncomeExpensesViewProps {
  clientId: string;
  initialIncomes: Income[];
  initialExpenses: Expense[];
  initialSavingsRules: SavingsRule[];
  initialWithdrawalStrategies: WithdrawalStrategy[];
  accounts: Account[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = (value: string | number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(
    Number(value)
  );

const INCOME_GROUPS: { label: string; types: IncomeType[] }[] = [
  { label: "Salaries", types: ["salary"] },
  { label: "Social Security", types: ["social_security"] },
  { label: "Business", types: ["business"] },
  { label: "Deferred", types: ["deferred"] },
  { label: "Capital Gains", types: ["capital_gains"] },
  { label: "Trust", types: ["trust"] },
  { label: "Other Income", types: ["other"] },
];

const EXPENSE_GROUPS: { label: string; types: ExpenseType[] }[] = [
  { label: "Living Expenses", types: ["living"] },
  { label: "Insurance", types: ["insurance"] },
  { label: "Other Expenses", types: ["other"] },
];

const INCOME_TYPE_LABELS: Record<IncomeType, string> = {
  salary: "Salary",
  social_security: "Social Security",
  business: "Business",
  deferred: "Deferred",
  capital_gains: "Capital Gains",
  trust: "Trust",
  other: "Other",
};

const OWNER_LABELS: Record<Owner, string> = {
  client: "Client",
  spouse: "Spouse",
  joint: "Joint",
};

// ── Add Income Dialog ─────────────────────────────────────────────────────────

interface AddIncomeDialogProps {
  clientId: string;
  defaultType: IncomeType;
  accounts: Account[];
  onAdd: (income: Income) => void;
}

function AddIncomeDialog({ clientId, defaultType, accounts, onAdd }: AddIncomeDialogProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<IncomeType>(defaultType);
  const currentYear = new Date().getFullYear();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const data = new FormData(e.currentTarget);
    const body = {
      type: data.get("type") as string,
      name: data.get("name") as string,
      annualAmount: data.get("annualAmount") as string,
      startYear: data.get("startYear") as string,
      endYear: data.get("endYear") as string,
      growthRate: String(Number(data.get("growthRate") as string) / 100),
      owner: data.get("owner") as string,
      claimingAge: data.get("claimingAge") ? data.get("claimingAge") as string : null,
      linkedEntityId: data.get("linkedEntityId") || null,
    };

    try {
      const res = await fetch(`/api/clients/${clientId}/incomes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? "Failed to create income");
      }

      const created = await res.json() as Income;
      onAdd(created);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  const needsLinkedEntity = type === "business" || type === "trust";
  const needsClaimingAge = type === "social_security";

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-100 text-gray-500 hover:bg-blue-100 hover:text-blue-600"
        title="Add income"
      >
        <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
        </svg>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="relative z-10 w-full max-w-lg rounded-lg bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Add Income</h2>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600">
                <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700" htmlFor="inc-type">Type</label>
                  <select
                    id="inc-type"
                    name="type"
                    required
                    value={type}
                    onChange={(e) => setType(e.target.value as IncomeType)}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    {Object.entries(INCOME_TYPE_LABELS).map(([v, l]) => (
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700" htmlFor="inc-owner">Owner</label>
                  <select
                    id="inc-owner"
                    name="owner"
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="client">Client</option>
                    <option value="spouse">Spouse</option>
                    <option value="joint">Joint</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700" htmlFor="inc-name">Name <span className="text-red-500">*</span></label>
                <input
                  id="inc-name"
                  name="name"
                  type="text"
                  required
                  placeholder="e.g., Base Salary"
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700" htmlFor="inc-amount">Annual Amount ($) <span className="text-red-500">*</span></label>
                  <input
                    id="inc-amount"
                    name="annualAmount"
                    type="number"
                    step="1"
                    min={0}
                    required
                    defaultValue={0}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700" htmlFor="inc-growth">Growth Rate (%)</label>
                  <input
                    id="inc-growth"
                    name="growthRate"
                    type="number"
                    step="0.1"
                    min={0}
                    max={30}
                    defaultValue={3}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700" htmlFor="inc-start">Start Year <span className="text-red-500">*</span></label>
                  <input
                    id="inc-start"
                    name="startYear"
                    type="number"
                    required
                    defaultValue={currentYear}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700" htmlFor="inc-end">End Year <span className="text-red-500">*</span></label>
                  <input
                    id="inc-end"
                    name="endYear"
                    type="number"
                    required
                    defaultValue={currentYear + 20}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              {needsClaimingAge && (
                <div>
                  <label className="block text-sm font-medium text-gray-700" htmlFor="inc-claiming">Claiming Age</label>
                  <input
                    id="inc-claiming"
                    name="claimingAge"
                    type="number"
                    min={62}
                    max={70}
                    defaultValue={67}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              )}

              {needsLinkedEntity && accounts.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700" htmlFor="inc-linked">Linked Account (optional)</label>
                  <select
                    id="inc-linked"
                    name="linkedEntityId"
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="">None</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  disabled={loading}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {loading ? "Adding..." : "Add Income"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

// ── Add Expense Dialog ────────────────────────────────────────────────────────

interface AddExpenseDialogProps {
  clientId: string;
  defaultType: ExpenseType;
  onAdd: (expense: Expense) => void;
}

function AddExpenseDialog({ clientId, defaultType, onAdd }: AddExpenseDialogProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentYear = new Date().getFullYear();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const data = new FormData(e.currentTarget);
    const body = {
      type: data.get("type") as string,
      name: data.get("name") as string,
      annualAmount: data.get("annualAmount") as string,
      startYear: data.get("startYear") as string,
      endYear: data.get("endYear") as string,
      growthRate: String(Number(data.get("growthRate") as string) / 100),
    };

    try {
      const res = await fetch(`/api/clients/${clientId}/expenses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? "Failed to create expense");
      }

      const created = await res.json() as Expense;
      onAdd(created);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-100 text-gray-500 hover:bg-blue-100 hover:text-blue-600"
        title="Add expense"
      >
        <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
        </svg>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="relative z-10 w-full max-w-lg rounded-lg bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Add Expense</h2>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600">
                <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700" htmlFor="exp-type">Type</label>
                <select
                  id="exp-type"
                  name="type"
                  required
                  defaultValue={defaultType}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="living">Living Expense</option>
                  <option value="insurance">Insurance</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700" htmlFor="exp-name">Name <span className="text-red-500">*</span></label>
                <input
                  id="exp-name"
                  name="name"
                  type="text"
                  required
                  placeholder="e.g., Housing"
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700" htmlFor="exp-amount">Annual Amount ($) <span className="text-red-500">*</span></label>
                  <input
                    id="exp-amount"
                    name="annualAmount"
                    type="number"
                    step="1"
                    min={0}
                    required
                    defaultValue={0}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700" htmlFor="exp-growth">Growth Rate (%)</label>
                  <input
                    id="exp-growth"
                    name="growthRate"
                    type="number"
                    step="0.1"
                    min={0}
                    max={30}
                    defaultValue={3}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700" htmlFor="exp-start">Start Year <span className="text-red-500">*</span></label>
                  <input
                    id="exp-start"
                    name="startYear"
                    type="number"
                    required
                    defaultValue={currentYear}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700" htmlFor="exp-end">End Year <span className="text-red-500">*</span></label>
                  <input
                    id="exp-end"
                    name="endYear"
                    type="number"
                    required
                    defaultValue={currentYear + 20}
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
                  {loading ? "Adding..." : "Add Expense"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

// ── Add Savings Rule Dialog ───────────────────────────────────────────────────

interface AddSavingsRuleDialogProps {
  clientId: string;
  accounts: Account[];
  onAdd: (rule: SavingsRule) => void;
}

function AddSavingsRuleDialog({ clientId, accounts, onAdd }: AddSavingsRuleDialogProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentYear = new Date().getFullYear();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const data = new FormData(e.currentTarget);
    const matchPct = data.get("employerMatchPct") as string;
    const matchCap = data.get("employerMatchCap") as string;
    const limit = data.get("annualLimit") as string;

    const body = {
      accountId: data.get("accountId") as string,
      annualAmount: data.get("annualAmount") as string,
      startYear: data.get("startYear") as string,
      endYear: data.get("endYear") as string,
      employerMatchPct: matchPct ? String(Number(matchPct) / 100) : null,
      employerMatchCap: matchCap ? String(Number(matchCap) / 100) : null,
      annualLimit: limit || null,
    };

    try {
      const res = await fetch(`/api/clients/${clientId}/savings-rules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? "Failed to create savings rule");
      }

      const created = await res.json() as SavingsRule;
      onAdd(created);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  if (accounts.length === 0) {
    return (
      <span className="text-xs text-gray-400 italic">Add accounts first</span>
    );
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-100 text-gray-500 hover:bg-blue-100 hover:text-blue-600"
        title="Add savings rule"
      >
        <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
        </svg>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="relative z-10 w-full max-w-lg rounded-lg bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Add Savings Rule</h2>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600">
                <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700" htmlFor="sr-account">Account <span className="text-red-500">*</span></label>
                <select
                  id="sr-account"
                  name="accountId"
                  required
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700" htmlFor="sr-amount">Annual Amount ($) <span className="text-red-500">*</span></label>
                  <input
                    id="sr-amount"
                    name="annualAmount"
                    type="number"
                    step="1"
                    min={0}
                    required
                    defaultValue={0}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700" htmlFor="sr-limit">Annual Limit ($)</label>
                  <input
                    id="sr-limit"
                    name="annualLimit"
                    type="number"
                    step="1"
                    min={0}
                    placeholder="Optional"
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700" htmlFor="sr-match-pct">Employer Match (%)</label>
                  <input
                    id="sr-match-pct"
                    name="employerMatchPct"
                    type="number"
                    step="1"
                    min={0}
                    max={100}
                    placeholder="Optional"
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700" htmlFor="sr-match-cap">Match Cap (% of salary)</label>
                  <input
                    id="sr-match-cap"
                    name="employerMatchCap"
                    type="number"
                    step="0.1"
                    min={0}
                    max={100}
                    placeholder="Optional"
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700" htmlFor="sr-start">Start Year <span className="text-red-500">*</span></label>
                  <input
                    id="sr-start"
                    name="startYear"
                    type="number"
                    required
                    defaultValue={currentYear}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700" htmlFor="sr-end">End Year <span className="text-red-500">*</span></label>
                  <input
                    id="sr-end"
                    name="endYear"
                    type="number"
                    required
                    defaultValue={currentYear + 20}
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
                  {loading ? "Adding..." : "Add Rule"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

// ── Add Withdrawal Strategy Dialog ───────────────────────────────────────────

interface AddWithdrawalDialogProps {
  clientId: string;
  accounts: Account[];
  nextPriority: number;
  onAdd: (strategy: WithdrawalStrategy) => void;
}

function AddWithdrawalDialog({ clientId, accounts, nextPriority, onAdd }: AddWithdrawalDialogProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentYear = new Date().getFullYear();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const data = new FormData(e.currentTarget);
    const body = {
      accountId: data.get("accountId") as string,
      priorityOrder: Number(data.get("priorityOrder") as string),
      startYear: data.get("startYear") as string,
      endYear: data.get("endYear") as string,
    };

    try {
      const res = await fetch(`/api/clients/${clientId}/withdrawal-strategy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? "Failed to create withdrawal strategy");
      }

      const created = await res.json() as WithdrawalStrategy;
      onAdd(created);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  if (accounts.length === 0) {
    return (
      <span className="text-xs text-gray-400 italic">Add accounts first</span>
    );
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-100 text-gray-500 hover:bg-blue-100 hover:text-blue-600"
        title="Add withdrawal strategy"
      >
        <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
        </svg>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="relative z-10 w-full max-w-lg rounded-lg bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Add Withdrawal Account</h2>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600">
                <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700" htmlFor="ws-account">Account <span className="text-red-500">*</span></label>
                  <select
                    id="ws-account"
                    name="accountId"
                    required
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700" htmlFor="ws-priority">Priority Order</label>
                  <input
                    id="ws-priority"
                    name="priorityOrder"
                    type="number"
                    min={1}
                    required
                    defaultValue={nextPriority}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700" htmlFor="ws-start">Start Year <span className="text-red-500">*</span></label>
                  <input
                    id="ws-start"
                    name="startYear"
                    type="number"
                    required
                    defaultValue={currentYear}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700" htmlFor="ws-end">End Year <span className="text-red-500">*</span></label>
                  <input
                    id="ws-end"
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
                  {loading ? "Adding..." : "Add Account"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

// ── Delete button ─────────────────────────────────────────────────────────────

interface DeleteButtonProps {
  onDelete: () => Promise<void>;
}

function DeleteButton({ onDelete }: DeleteButtonProps) {
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    if (!confirm("Delete this item?")) return;
    setLoading(true);
    try {
      await onDelete();
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className="ml-2 text-gray-300 hover:text-red-500 disabled:opacity-50"
      title="Delete"
    >
      <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
      </svg>
    </button>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function IncomeExpensesView({
  clientId,
  initialIncomes,
  initialExpenses,
  initialSavingsRules,
  initialWithdrawalStrategies,
  accounts,
}: IncomeExpensesViewProps) {
  const [incomeList, setIncomeList] = useState<Income[]>(initialIncomes);
  const [expenseList, setExpenseList] = useState<Expense[]>(initialExpenses);
  const [savingsRuleList, setSavingsRuleList] = useState<SavingsRule[]>(initialSavingsRules);
  const [withdrawalList, setWithdrawalList] = useState<WithdrawalStrategy[]>(initialWithdrawalStrategies);

  // Live delta calculations
  const totalIncome = incomeList.reduce((sum, i) => sum + Number(i.annualAmount), 0);
  const totalExpenses = expenseList.reduce((sum, e) => sum + Number(e.annualAmount), 0);
  const netCashFlow = totalIncome - totalExpenses;

  // Account map for display
  const accountMap = Object.fromEntries(accounts.map((a) => [a.id, a]));

  // Delete handlers
  async function deleteIncome(incomeId: string) {
    await fetch(`/api/clients/${clientId}/incomes/${incomeId}`, { method: "DELETE" });
    setIncomeList((prev) => prev.filter((i) => i.id !== incomeId));
  }

  async function deleteExpense(expenseId: string) {
    await fetch(`/api/clients/${clientId}/expenses/${expenseId}`, { method: "DELETE" });
    setExpenseList((prev) => prev.filter((e) => e.id !== expenseId));
  }

  async function deleteSavingsRule(ruleId: string) {
    await fetch(`/api/clients/${clientId}/savings-rules/${ruleId}`, { method: "DELETE" });
    setSavingsRuleList((prev) => prev.filter((r) => r.id !== ruleId));
  }

  async function deleteWithdrawal(strategyId: string) {
    await fetch(`/api/clients/${clientId}/withdrawal-strategy/${strategyId}`, { method: "DELETE" });
    setWithdrawalList((prev) => prev.filter((w) => w.id !== strategyId));
  }

  const sortedWithdrawals = [...withdrawalList].sort((a, b) => a.priorityOrder - b.priorityOrder);
  const nextPriority = withdrawalList.length > 0
    ? Math.max(...withdrawalList.map((w) => w.priorityOrder)) + 1
    : 1;

  return (
    <div className="space-y-6">
      {/* Live Delta Bar */}
      <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-6 py-4 shadow-sm">
        <div className="flex items-center gap-8">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-gray-400">Total Income</p>
            <p className="text-lg font-bold text-gray-900">{fmt(totalIncome)}</p>
          </div>
          <div className="h-8 w-px bg-gray-200" />
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-gray-400">Total Expenses</p>
            <p className="text-lg font-bold text-gray-900">{fmt(totalExpenses)}</p>
          </div>
          <div className="h-8 w-px bg-gray-200" />
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-gray-400">Net Cash Flow</p>
            <p className={`text-lg font-bold ${netCashFlow >= 0 ? "text-green-600" : "text-red-600"}`}>
              {netCashFlow >= 0 ? "+" : ""}{fmt(netCashFlow)}
            </p>
          </div>
        </div>
      </div>

      {/* Two-column: Income + Expenses */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Income column */}
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-200 bg-gray-50 px-6 py-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500">Income</h2>
          </div>

          {INCOME_GROUPS.map((group) => {
            const items = incomeList.filter((i) => group.types.includes(i.type));
            return (
              <div key={group.label} className="border-b border-gray-100 last:border-0">
                {/* Group header */}
                <div className="flex items-center justify-between px-6 py-2 bg-gray-50/50">
                  <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                    {group.label}
                  </span>
                  <AddIncomeDialog
                    clientId={clientId}
                    defaultType={group.types[0]}
                    accounts={accounts}
                    onAdd={(income) => setIncomeList((prev) => [...prev, income])}
                  />
                </div>

                {/* Income rows */}
                {items.length === 0 ? (
                  <div className="px-6 py-3 text-sm text-gray-400 italic">None</div>
                ) : (
                  <table className="min-w-full">
                    <tbody className="divide-y divide-gray-50">
                      {items.map((income) => (
                        <tr key={income.id} className="group hover:bg-gray-50">
                          <td className="px-6 py-2 text-sm font-medium text-gray-900">
                            <div>{income.name}</div>
                            <div className="text-xs text-gray-400">
                              {OWNER_LABELS[income.owner]}
                              {income.claimingAge ? ` · Claiming age ${income.claimingAge}` : ""}
                              {income.linkedEntityId && accountMap[income.linkedEntityId]
                                ? ` · ${accountMap[income.linkedEntityId].name}`
                                : ""}
                            </div>
                          </td>
                          <td className="px-2 py-2 text-xs text-gray-400 whitespace-nowrap">
                            {income.startYear}–{income.endYear}
                          </td>
                          <td className="px-6 py-2 text-right text-sm font-medium text-gray-900 whitespace-nowrap">
                            {fmt(income.annualAmount)}/yr
                            <DeleteButton onDelete={() => deleteIncome(income.id)} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
        </div>

        {/* Expense column */}
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-200 bg-gray-50 px-6 py-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500">Expenses</h2>
          </div>

          {EXPENSE_GROUPS.map((group) => {
            const items = expenseList.filter((e) => group.types.includes(e.type));
            return (
              <div key={group.label} className="border-b border-gray-100 last:border-0">
                {/* Group header */}
                <div className="flex items-center justify-between px-6 py-2 bg-gray-50/50">
                  <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                    {group.label}
                  </span>
                  <AddExpenseDialog
                    clientId={clientId}
                    defaultType={group.types[0]}
                    onAdd={(expense) => setExpenseList((prev) => [...prev, expense])}
                  />
                </div>

                {/* Expense rows */}
                {items.length === 0 ? (
                  <div className="px-6 py-3 text-sm text-gray-400 italic">None</div>
                ) : (
                  <table className="min-w-full">
                    <tbody className="divide-y divide-gray-50">
                      {items.map((expense) => (
                        <tr key={expense.id} className="group hover:bg-gray-50">
                          <td className="px-6 py-2 text-sm font-medium text-gray-900">
                            {expense.name}
                          </td>
                          <td className="px-2 py-2 text-xs text-gray-400 whitespace-nowrap">
                            {expense.startYear}–{expense.endYear}
                          </td>
                          <td className="px-6 py-2 text-right text-sm font-medium text-gray-900 whitespace-nowrap">
                            {fmt(expense.annualAmount)}/yr
                            <DeleteButton onDelete={() => deleteExpense(expense.id)} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Savings Rules */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-6 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500">Savings Rules</h2>
          <AddSavingsRuleDialog
            clientId={clientId}
            accounts={accounts}
            onAdd={(rule) => setSavingsRuleList((prev) => [...prev, rule])}
          />
        </div>

        {savingsRuleList.length === 0 ? (
          <div className="px-6 py-6 text-center text-sm text-gray-400 italic">No savings rules yet</div>
        ) : (
          <table className="min-w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="px-6 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-400">Account</th>
                <th className="px-6 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-400">Years</th>
                <th className="px-6 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-400">Employer Match</th>
                <th className="px-6 py-2 text-right text-xs font-medium uppercase tracking-wider text-gray-400">Annual Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {savingsRuleList.map((rule) => (
                <tr key={rule.id} className="group hover:bg-gray-50">
                  <td className="px-6 py-3 text-sm font-medium text-gray-900">
                    {accountMap[rule.accountId]?.name ?? rule.accountId}
                  </td>
                  <td className="px-6 py-3 text-sm text-gray-500">
                    {rule.startYear}–{rule.endYear}
                  </td>
                  <td className="px-6 py-3 text-sm text-gray-500">
                    {rule.employerMatchPct
                      ? `${(Number(rule.employerMatchPct) * 100).toFixed(0)}% match`
                      : "—"}
                    {rule.employerMatchCap
                      ? ` (cap ${(Number(rule.employerMatchCap) * 100).toFixed(1)}%)`
                      : ""}
                  </td>
                  <td className="px-6 py-3 text-right text-sm font-medium text-gray-900 whitespace-nowrap">
                    {fmt(rule.annualAmount)}/yr
                    <DeleteButton onDelete={() => deleteSavingsRule(rule.id)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Withdrawal Strategy */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-6 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500">Withdrawal Strategy</h2>
          <AddWithdrawalDialog
            clientId={clientId}
            accounts={accounts}
            nextPriority={nextPriority}
            onAdd={(strategy) => setWithdrawalList((prev) => [...prev, strategy])}
          />
        </div>

        {sortedWithdrawals.length === 0 ? (
          <div className="px-6 py-6 text-center text-sm text-gray-400 italic">No withdrawal order set</div>
        ) : (
          <table className="min-w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="px-6 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-400">Priority</th>
                <th className="px-6 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-400">Account</th>
                <th className="px-6 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-400">Years</th>
                <th className="px-6 py-2 text-right text-xs font-medium uppercase tracking-wider text-gray-400"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {sortedWithdrawals.map((ws) => (
                <tr key={ws.id} className="group hover:bg-gray-50">
                  <td className="px-6 py-3">
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-gray-100 text-xs font-bold text-gray-600">
                      {ws.priorityOrder}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-sm font-medium text-gray-900">
                    {accountMap[ws.accountId]?.name ?? ws.accountId}
                  </td>
                  <td className="px-6 py-3 text-sm text-gray-500">
                    {ws.startYear}–{ws.endYear}
                  </td>
                  <td className="px-6 py-3 text-right">
                    <DeleteButton onDelete={() => deleteWithdrawal(ws.id)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
