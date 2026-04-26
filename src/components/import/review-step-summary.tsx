"use client";

import type {
  ExtractedAccount,
  ExtractedIncome,
  ExtractedExpense,
  ExtractedLiability,
  ExtractedEntity,
} from "@/lib/extraction/types";

interface ReviewStepSummaryProps {
  accounts: ExtractedAccount[];
  incomes: ExtractedIncome[];
  expenses: ExtractedExpense[];
  liabilities: ExtractedLiability[];
  entities: ExtractedEntity[];
  onCommit: () => void;
  isCommitting: boolean;
}

const fmt = (val: number | undefined) =>
  val != null
    ? new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(val)
    : "—";

export default function ReviewStepSummary({
  accounts,
  incomes,
  expenses,
  liabilities,
  entities,
  onCommit,
  isCommitting,
}: ReviewStepSummaryProps) {
  const totalAccountValue = accounts.reduce((sum, a) => sum + (a.value ?? 0), 0);
  const totalIncome = incomes.reduce((sum, i) => sum + (i.annualAmount ?? 0), 0);
  const totalExpenses = expenses.reduce((sum, e) => sum + (e.annualAmount ?? 0), 0);
  const totalLiabilities = liabilities.reduce((sum, l) => sum + (l.balance ?? 0), 0);

  const hasData =
    accounts.length > 0 ||
    incomes.length > 0 ||
    expenses.length > 0 ||
    liabilities.length > 0 ||
    entities.length > 0;

  const warnings: string[] = [];
  const emptyNameAccounts = accounts.filter((a) => !a.name).length;
  const emptyNameIncomes = incomes.filter((i) => !i.name).length;
  const noCategoryAccounts = accounts.filter((a) => !a.category).length;
  if (emptyNameAccounts > 0) warnings.push(`${emptyNameAccounts} account(s) missing a name`);
  if (emptyNameIncomes > 0) warnings.push(`${emptyNameIncomes} income(s) missing a name`);
  if (noCategoryAccounts > 0) warnings.push(`${noCategoryAccounts} account(s) missing a category`);

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-medium text-gray-100">Summary</h3>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Accounts" count={accounts.length} total={fmt(totalAccountValue)} />
        <StatCard label="Income" count={incomes.length} total={`${fmt(totalIncome)}/yr`} />
        <StatCard label="Expenses" count={expenses.length} total={`${fmt(totalExpenses)}/yr`} />
        <StatCard label="Liabilities" count={liabilities.length} total={fmt(totalLiabilities)} />
      </div>

      {entities.length > 0 && (
        <div className="rounded-md border border-gray-700 bg-gray-900 p-3">
          <span className="text-sm text-gray-300">
            {entities.length} entit{entities.length === 1 ? "y" : "ies"} to create
          </span>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="rounded-md border border-amber-700/50 bg-amber-900/20 p-3">
          <p className="mb-1 text-sm font-medium text-amber-400">Warnings</p>
          <ul className="space-y-1">
            {warnings.map((w, i) => (
              <li key={i} className="text-xs text-amber-300">
                {w}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-gray-300">
            You can go back to fix these, or commit as-is (defaults will be applied).
          </p>
        </div>
      )}

      <button
        onClick={onCommit}
        disabled={!hasData || isCommitting}
        className="w-full rounded-md bg-blue-600 px-4 py-3 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {isCommitting ? "Adding to Details..." : "Add to Details"}
      </button>

      {!hasData && (
        <p className="text-center text-sm text-gray-400">
          No data to commit. Go back and add items, or upload more documents.
        </p>
      )}
    </div>
  );
}

function StatCard({
  label,
  count,
  total,
}: {
  label: string;
  count: number;
  total: string;
}) {
  return (
    <div className="rounded-md border border-gray-700 bg-gray-900 p-3">
      <p className="text-xs text-gray-300">{label}</p>
      <p className="mt-1 text-xl font-semibold text-gray-100">{count}</p>
      <p className="text-xs text-gray-300">{total}</p>
    </div>
  );
}
