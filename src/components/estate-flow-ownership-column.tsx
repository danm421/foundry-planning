import type {
  OwnershipColumnData,
  OwnershipGroup,
  OwnershipAssetRow,
} from "@/lib/estate/estate-flow-ownership";

// ── Currency formatter (matches estate-transfer-recipient-card.tsx) ───────────

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

// ── Kind label ────────────────────────────────────────────────────────────────

const KIND_LABEL: Record<OwnershipGroup["kind"], string> = {
  client: "Individual",
  spouse: "Individual",
  joint: "Joint",
  trust: "Trust",
  business: "Business",
};

// ── AccountType chip ──────────────────────────────────────────────────────────

function AccountTypeChip({ type }: { type: string }) {
  const label = type
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return (
    <span className="rounded bg-gray-800/70 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-gray-400">
      {label}
    </span>
  );
}

// ── Asset row ─────────────────────────────────────────────────────────────────

interface AssetRowProps {
  asset: OwnershipAssetRow;
  onAssetClick: (accountId: string) => void;
}

function AssetRow({ asset, onAssetClick }: AssetRowProps) {
  const hasLinkedLiabilities = asset.linkedLiabilities.length > 0;

  return (
    <li>
      <button
        type="button"
        onClick={() => onAssetClick(asset.accountId)}
        className="w-full rounded px-2 py-1.5 text-left transition-colors hover:bg-gray-800/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-500/60"
      >
        {/* Primary row */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-0.5">
            {/* Name + badges */}
            <div className="flex flex-wrap items-center gap-1">
              <span className="truncate text-sm text-gray-100">
                {asset.name}
              </span>
              {asset.isSplit && (
                <span className="rounded bg-indigo-900/40 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-indigo-300">
                  {Math.round(asset.percent * 100)}%
                </span>
              )}
              {asset.hasBeneficiaries && (
                <span
                  title="Has beneficiary designations"
                  className="rounded bg-emerald-900/30 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-400"
                >
                  Beneficiary
                </span>
              )}
              {asset.hasConflict && (
                <span
                  title="No beneficiary and no will provision"
                  className="rounded bg-rose-900/40 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-rose-300"
                >
                  No Plan
                </span>
              )}
            </div>
            <AccountTypeChip type={asset.accountType} />
          </div>

          {/* Value column */}
          <div className="flex flex-col items-end gap-0.5 text-right">
            <span className="text-sm tabular-nums text-gray-100">
              {fmt.format(asset.value)}
            </span>
            {hasLinkedLiabilities && (
              <span className="text-xs tabular-nums text-gray-400">
                net {fmt.format(asset.netValue)}
              </span>
            )}
          </div>
        </div>

        {/* Linked liabilities */}
        {hasLinkedLiabilities && (
          <div className="mt-1 space-y-0.5 pl-2">
            {asset.linkedLiabilities.map((liab) => (
              <div
                key={liab.liabilityId}
                className="flex items-baseline justify-between gap-4 text-xs text-gray-500"
              >
                <span className="truncate">{liab.name}</span>
                <span className="tabular-nums text-rose-400/80">
                  −{fmt.format(liab.balance)}
                </span>
              </div>
            ))}
          </div>
        )}
      </button>
    </li>
  );
}

// ── Group card ────────────────────────────────────────────────────────────────

interface GroupCardProps {
  group: OwnershipGroup;
  onAssetClick: (accountId: string) => void;
}

function GroupCard({ group, onAssetClick }: GroupCardProps) {
  const kindLabel = KIND_LABEL[group.kind];

  return (
    <section className="rounded-lg border border-gray-800/80 bg-gray-900/50 px-4 py-3">
      {/* Header */}
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="flex items-baseline gap-2 text-sm font-semibold text-gray-100">
          <span>{group.label}</span>
          <span className="text-[10px] font-medium uppercase tracking-wider text-gray-500">
            {kindLabel}
          </span>
        </h3>
        <span className="text-base font-semibold tabular-nums text-gray-50">
          {fmt.format(group.subtotal)}
        </span>
      </div>

      {/* Asset list */}
      <ul className="mt-2 space-y-0.5">
        {group.assets.map((asset) => (
          <AssetRow
            key={`${asset.accountId}-${group.key}`}
            asset={asset}
            onAssetClick={onAssetClick}
          />
        ))}
      </ul>
    </section>
  );
}

// ── EstateFlowOwnershipColumn ─────────────────────────────────────────────────

interface EstateFlowOwnershipColumnProps {
  data: OwnershipColumnData;
  onAssetClick: (accountId: string) => void;
}

export function EstateFlowOwnershipColumn({
  data,
  onAssetClick,
}: EstateFlowOwnershipColumnProps) {
  if (data.groups.length === 0) {
    return (
      <div className="flex items-center justify-center rounded border border-gray-800/60 p-6 text-sm text-gray-500">
        No assets
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Column heading */}
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
          Ownership
        </h2>
      </div>

      {/* Group cards */}
      <div className="space-y-3">
        {data.groups.map((group) => (
          <GroupCard key={group.key} group={group} onAssetClick={onAssetClick} />
        ))}
      </div>

      {/* Grand total footer */}
      <div className="flex items-baseline justify-between gap-3 rounded border border-gray-800/40 bg-gray-900/30 px-3 py-2">
        <span className="text-xs font-medium uppercase tracking-wider text-gray-400">
          Total
        </span>
        <span className="text-sm font-semibold tabular-nums text-gray-50">
          {fmt.format(data.grandTotal)}
        </span>
      </div>
    </div>
  );
}
