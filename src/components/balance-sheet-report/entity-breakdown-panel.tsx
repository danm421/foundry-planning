"use client";

import type { BalanceSheetViewModel } from "./view-model";
import { SCREEN_THEME } from "./tokens";

interface EntityBreakdownPanelProps {
  viewModel: BalanceSheetViewModel;
}

const ENTITY_TYPE_LABEL: Record<string, string> = {
  trust: "Trust",
  llc: "LLC",
  s_corp: "S-Corp",
  c_corp: "C-Corp",
  partnership: "Partnership",
  foundation: "Foundation",
  other: "Entity",
};

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

export default function EntityBreakdownPanel({ viewModel }: EntityBreakdownPanelProps) {
  const groups = viewModel.entityGroups ?? [];

  if (groups.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-300">
          Entities
        </h2>
        <div className={`${SCREEN_THEME.surface.panel} p-6 text-center text-sm text-gray-400`}>
          No entity-owned positions.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-300">
        Entities
      </h2>

      {groups.map((group) => (
        <div key={group.entityId} className={SCREEN_THEME.surface.panel}>
          <div className={`${SCREEN_THEME.surface.panelHeader} flex items-center justify-between`}>
            <div className="flex items-center gap-2">
              <span className={`text-sm font-semibold ${SCREEN_THEME.text.primary}`}>
                {group.entityName}
              </span>
              <span className="rounded bg-gray-800 px-1.5 py-0.5 text-xs uppercase tracking-wide text-gray-300">
                {ENTITY_TYPE_LABEL[group.entityType] ?? group.entityType}
              </span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-xs uppercase tracking-wide text-accent-ink">
                Net Worth
              </span>
              <span className="text-base font-bold text-gray-100">
                {formatCurrency(group.netWorth)}
              </span>
            </div>
          </div>

          {group.assetRows.length > 0 && (
            <div className="px-4 pb-2 pt-2">
              <div className="flex items-center justify-between pb-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Assets
                </span>
                <span className="text-xs font-semibold text-emerald-400">
                  {formatCurrency(group.assetTotal)}
                </span>
              </div>
              {group.assetRows.map((row) => (
                <div
                  key={row.rowKey}
                  className="flex items-center justify-between border-b border-gray-800/60 py-1 last:border-b-0"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-300">{row.accountName}</span>
                    {row.ownerPercent < 0.9999 && (
                      <span className="rounded bg-gray-800 px-1.5 py-0.5 text-xs text-gray-400">
                        {Math.round(row.ownerPercent * 100)}% share
                      </span>
                    )}
                    {row.isFlatBusinessValue && (
                      <span className="rounded border border-blue-800 bg-blue-950/40 px-1 text-xs font-medium uppercase text-blue-300">
                        BIZ
                      </span>
                    )}
                  </div>
                  <span className="text-sm text-gray-200">{formatCurrency(row.value)}</span>
                </div>
              ))}
            </div>
          )}

          {group.liabilityRows.length > 0 && (
            <div className="border-t border-gray-800 px-4 pb-3 pt-2">
              <div className="flex items-center justify-between pb-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Liabilities
                </span>
                <span className="text-xs font-semibold text-rose-400">
                  −{formatCurrency(group.liabilityTotal)}
                </span>
              </div>
              {group.liabilityRows.map((row) => (
                <div
                  key={row.rowKey}
                  className="flex items-center justify-between border-b border-gray-800/60 py-1 last:border-b-0"
                >
                  <span className="text-sm text-gray-300">{row.liabilityName}</span>
                  <span className="text-sm text-gray-200">
                    −{formatCurrency(row.balance)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
