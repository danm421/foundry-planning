"use client";

import type { SavingsRuleRow } from "./savings-rule-dialog";

interface AccountLabel {
  id: string;
  name: string;
}

interface Props {
  rules: SavingsRuleRow[];
  accountsById?: Record<string, AccountLabel>;
  showAccountColumn?: boolean;
  onEdit: (rule: SavingsRuleRow) => void;
  onDelete: (rule: SavingsRuleRow) => void;
  onAdd: () => void;
  emptyMessage?: string;
}

export default function SavingsRulesList({
  rules,
  accountsById = {},
  showAccountColumn = false,
  onEdit,
  onDelete,
  onAdd,
  emptyMessage = "No savings rules yet.",
}: Props) {
  const fmt = (v: string | number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(
      Number(v)
    );

  const formatPercent = (decimal: string | number): string => {
    const pct = Number(decimal) * 100;
    return Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(1)}%`;
  };

  const formatContribution = (rule: SavingsRuleRow): string => {
    if (rule.contributeMax) return "IRS max/yr";
    if (rule.annualPercent != null && Number(rule.annualPercent) > 0) {
      return `${formatPercent(rule.annualPercent)} of salary/yr`;
    }
    return `${fmt(rule.annualAmount)}/yr`;
  };

  const formatMatch = (rule: SavingsRuleRow): string | null => {
    if (rule.employerMatchAmount && Number(rule.employerMatchAmount) > 0) {
      return `+${fmt(rule.employerMatchAmount)} match`;
    }
    if (rule.employerMatchPct && Number(rule.employerMatchPct) > 0) {
      const rate = formatPercent(rule.employerMatchPct);
      if (rule.employerMatchCap && Number(rule.employerMatchCap) > 0) {
        return `+${rate} match up to ${formatPercent(rule.employerMatchCap)}`;
      }
      return `+${rate} match`;
    }
    return null;
  };

  return (
    <div className="flex flex-col gap-2">
      {rules.length === 0 ? (
        <p className="text-sm text-gray-400">{emptyMessage}</p>
      ) : (
        <div className="divide-y divide-gray-800 rounded-md border border-gray-800">
          {rules.map((rule) => {
            const matchSummary = formatMatch(rule);
            return (
            <div key={rule.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-gray-100">
                  {formatContribution(rule)}
                  {showAccountColumn && accountsById[rule.accountId] && (
                    <span className="ml-2 text-gray-400">→ {accountsById[rule.accountId].name}</span>
                  )}
                </div>
                <div className="text-xs text-gray-400">
                  {rule.startYear}–{rule.endYear}
                  {matchSummary && <span> · {matchSummary}</span>}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => onEdit(rule)}
                  className="rounded border border-gray-700 bg-gray-800 px-2.5 py-1 text-xs font-medium text-gray-300 hover:bg-gray-700"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(rule)}
                  className="rounded border border-red-800 bg-red-900/30 px-2.5 py-1 text-xs font-medium text-red-400 hover:bg-red-900/60"
                >
                  Delete
                </button>
              </div>
            </div>
            );
          })}
        </div>
      )}
      <div className="mt-1">
        <button
          type="button"
          onClick={onAdd}
          className="w-full rounded-md border border-dashed border-gray-700 py-2 text-sm text-gray-300 hover:border-gray-500 hover:text-gray-200"
        >
          + Add savings rule
        </button>
      </div>
    </div>
  );
}
