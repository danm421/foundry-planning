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
  onEdit?: (rule: SavingsRuleRow) => void;
  onDelete?: (rule: SavingsRuleRow) => void;
  onAdd?: () => void;
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

  const formatRothTag = (rule: SavingsRuleRow): string | null => {
    const roth = rule.rothPercent != null ? Number(rule.rothPercent) : 0;
    if (roth <= 0) return null;
    if (roth >= 1) return "Roth";
    return "Roth + Pre-tax";
  };

  return (
    <div className="flex flex-col gap-2">
      {rules.length === 0 ? (
        <p className="text-sm text-ink-3">{emptyMessage}</p>
      ) : (
        <div className="divide-y divide-hair rounded-md border border-hair">
          {rules.map((rule) => {
            const matchSummary = formatMatch(rule);
            const rothTag = formatRothTag(rule);
            return (
            <div key={rule.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-ink">
                  {formatContribution(rule)}
                  {showAccountColumn && accountsById[rule.accountId] && (
                    <span className="ml-2 text-ink-3">→ {accountsById[rule.accountId].name}</span>
                  )}
                </div>
                <div className="text-xs text-ink-3">
                  {rule.startYear}–{rule.endYear}
                  {matchSummary && <span> · {matchSummary}</span>}
                  {rothTag && (
                    <span className="ml-2 rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-accent-ink">
                      {rothTag}
                    </span>
                  )}
                </div>
              </div>
              {(onEdit || onDelete) && (
                <div className="flex items-center gap-2 flex-shrink-0">
                  {onEdit && (
                    <button
                      type="button"
                      onClick={() => onEdit(rule)}
                      className="rounded border border-hair-3 bg-card-2 px-2.5 py-1 text-xs font-medium text-ink-3 hover:bg-card-hover"
                    >
                      Edit
                    </button>
                  )}
                  {onDelete && (
                    <button
                      type="button"
                      onClick={() => onDelete(rule)}
                      className="rounded border border-crit/30 bg-crit/10 px-2.5 py-1 text-xs font-medium text-crit hover:bg-crit/20"
                    >
                      Delete
                    </button>
                  )}
                </div>
              )}
            </div>
            );
          })}
        </div>
      )}
      {onAdd && (
        <div className="mt-1">
          <button
            type="button"
            onClick={onAdd}
            className="w-full rounded-md border border-dashed border-hair-3 py-2 text-sm text-ink-3 hover:border-ink-4 hover:text-ink-2"
          >
            + Add savings rule
          </button>
        </div>
      )}
    </div>
  );
}
