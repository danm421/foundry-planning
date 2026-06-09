// src/components/asset-ledger/asset-ledger-filters.tsx
"use client";

export interface AssetFilterState {
  hideZero: boolean;
}

export default function AssetLedgerFilters({
  state,
  onChange,
}: {
  state: AssetFilterState;
  onChange: (next: AssetFilterState) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-1 text-xs text-ink-2">
        <input
          type="checkbox"
          checked={state.hideZero}
          onChange={(e) => onChange({ ...state, hideZero: e.target.checked })}
        />
        Hide zero rows
      </label>
    </div>
  );
}
