"use client";

import type { BalanceSheetViewModel, AssetRow, AssetCategoryGroup } from "./view-model";
import { SCREEN_THEME, CATEGORY_HEX } from "./tokens";
import type { OwnerNames } from "@/lib/owner-labels";
import { individualOwnerLabel } from "@/lib/owner-labels";
import type { YoyResult } from "./yoy";

interface AssetsPanelProps {
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

function OwnerChip({
  owner,
  ownerEntityId,
  names,
  entityLabelById,
}: {
  owner: AssetRow["owner"];
  ownerEntityId: string | null;
  names: OwnerNames;
  entityLabelById: Map<string, string>;
}) {
  const label = ownerEntityId
    ? entityLabelById.get(ownerEntityId) ?? "Entity"
    : individualOwnerLabel(owner, names);
  return (
    <span className="rounded bg-gray-800 px-1.5 py-0.5 text-xs text-gray-300">
      {label}
    </span>
  );
}

function AccountRow({
  row,
  showOwnerChip,
  names,
  entityLabelById,
}: {
  row: AssetRow;
  showOwnerChip: boolean;
  names: OwnerNames;
  entityLabelById: Map<string, string>;
}) {
  return (
    <div className="flex items-center justify-between border-b border-gray-800/60 py-1.5 last:border-b-0">
      <div className="flex items-center gap-2 text-sm text-gray-300">
        <span>{row.accountName}</span>
        {row.hasLinkedMortgage && (
          <span
            className="rounded border border-amber-800 bg-amber-950/50 px-1 text-xs font-medium uppercase text-amber-400"
            title="Has linked mortgage — see Liabilities"
          >
            M
          </span>
        )}
        {showOwnerChip && (
          <OwnerChip
            owner={row.owner}
            ownerEntityId={row.ownerEntityId}
            names={names}
            entityLabelById={entityLabelById}
          />
        )}
      </div>
      <span className="text-sm text-gray-200">{formatCurrency(row.value)}</span>
    </div>
  );
}

function CategoryCard({
  cat,
  showOwnerChips,
  names,
  entityLabelById,
}: {
  cat: AssetCategoryGroup;
  showOwnerChips: boolean;
  names: OwnerNames;
  entityLabelById: Map<string, string>;
}) {
  return (
    <div className={SCREEN_THEME.surface.panel}>
      <div className={`${SCREEN_THEME.surface.panelHeader} flex items-center justify-between`}>
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: CATEGORY_HEX[cat.key] }}
          />
          <span className={`text-xs font-semibold uppercase tracking-wide ${SCREEN_THEME.text.secondary}`}>
            {cat.label}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-sm font-semibold ${SCREEN_THEME.text.primary}`}>
            {formatCurrency(cat.total)}
          </span>
          <YoyBadge yoy={cat.yoy} />
        </div>
      </div>
      <div className="px-4 pb-3 pt-1">
        {cat.rows.map((row) => (
          <AccountRow
            key={row.accountId}
            row={row}
            showOwnerChip={showOwnerChips}
            names={names}
            entityLabelById={entityLabelById}
          />
        ))}
      </div>
    </div>
  );
}

export default function AssetsPanel({
  viewModel,
  ownerNames,
  showOwnerChips,
  entityLabelById,
}: AssetsPanelProps) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-300">Assets</h2>

      {viewModel.assetCategories.length === 0 && (
        <div className={`${SCREEN_THEME.surface.panel} p-6 text-center text-sm text-gray-400`}>
          No assets in this view.
        </div>
      )}

      {viewModel.assetCategories.map((cat) => (
        <CategoryCard
          key={cat.key}
          cat={cat}
          showOwnerChips={showOwnerChips}
          names={ownerNames}
          entityLabelById={entityLabelById}
        />
      ))}
    </div>
  );
}
