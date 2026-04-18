"use client";

import type { BalanceSheetViewModel, LiabilityRow } from "./view-model";
import { SCREEN_THEME } from "./tokens";
import type { OwnerNames } from "@/lib/owner-labels";
import { individualOwnerLabel } from "@/lib/owner-labels";
import type { YoyResult } from "./yoy";

interface LiabilitiesPanelProps {
  viewModel: BalanceSheetViewModel;
  ownerNames: OwnerNames;
  showOwnerChips: boolean;
  entityLabelById: Map<string, string>;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function YoyBadge({ yoy }: { yoy: YoyResult | null }) {
  if (yoy == null) return null;
  const cls = SCREEN_THEME.status[yoy.badge];
  const arrow = yoy.badge === "up" ? "▲" : yoy.badge === "down" ? "▼" : "·";
  const sign = yoy.value > 0 ? "+" : "";
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ${cls}`}>
      {arrow} {sign}{yoy.value.toFixed(1)}%
    </span>
  );
}

function LiabilityRowView({
  row,
  showOwnerChip,
  names,
  entityLabelById,
}: {
  row: LiabilityRow;
  showOwnerChip: boolean;
  names: OwnerNames;
  entityLabelById: Map<string, string>;
}) {
  const ownerLabel = row.ownerEntityId
    ? entityLabelById.get(row.ownerEntityId) ?? "Entity"
    : row.owner
      ? individualOwnerLabel(row.owner, names)
      : null;
  return (
    <div className="flex items-center justify-between border-b border-gray-800/60 py-1.5 last:border-b-0">
      <div className="flex items-center gap-2 text-sm text-gray-300">
        <span>{row.liabilityName}</span>
        {showOwnerChip && ownerLabel && (
          <span className="rounded bg-gray-800 px-1.5 py-0.5 text-xs text-gray-400">
            {ownerLabel}
          </span>
        )}
      </div>
      <span className="text-sm text-gray-200">{formatCurrency(row.balance)}</span>
    </div>
  );
}

export default function LiabilitiesPanel({
  viewModel,
  ownerNames,
  showOwnerChips,
  entityLabelById,
}: LiabilitiesPanelProps) {
  const hasRows = viewModel.liabilityRows.length > 0;
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Liabilities &amp; Net Worth</h2>

      <div className={SCREEN_THEME.surface.panel}>
        <div className={`${SCREEN_THEME.surface.panelHeader} flex items-center justify-between`}>
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
            Total Liabilities
          </span>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-100">
              {formatCurrency(viewModel.totalLiabilities)}
            </span>
            <YoyBadge yoy={viewModel.yoy.totalLiabilities} />
          </div>
        </div>
        <div className="px-4 pb-3 pt-1">
          {hasRows ? (
            viewModel.liabilityRows.map((row) => (
              <LiabilityRowView
                key={row.liabilityId}
                row={row}
                showOwnerChip={showOwnerChips}
                names={ownerNames}
                entityLabelById={entityLabelById}
              />
            ))
          ) : (
            <div className="py-2 text-center text-sm text-gray-500">No liabilities.</div>
          )}
        </div>
      </div>
    </div>
  );
}
