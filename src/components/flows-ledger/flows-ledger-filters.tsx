// src/components/flows-ledger/flows-ledger-filters.tsx
"use client";

import { FLOW_CATEGORY_LABEL, type FlowCategory } from "@/lib/flows-ledger";

export interface FlowsFilterState {
  /** Empty = show all categories. */
  categories: Set<FlowCategory>;
  hideZero: boolean;
}

export default function FlowsLedgerFilters({
  present,
  state,
  onChange,
}: {
  /** Categories actually appearing in the selected year (no dead chips). */
  present: FlowCategory[];
  state: FlowsFilterState;
  onChange: (next: FlowsFilterState) => void;
}) {
  function toggle(c: FlowCategory) {
    const next = new Set(state.categories);
    if (next.has(c)) next.delete(c);
    else next.add(c);
    onChange({ ...state, categories: next });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {present.map((c) => {
        const active = state.categories.size === 0 || state.categories.has(c);
        return (
          <button
            key={c}
            type="button"
            onClick={() => toggle(c)}
            className={`rounded-full border px-2.5 py-1 text-xs ${
              active ? "border-accent bg-accent/10 text-ink" : "border-hair bg-card text-ink-3"
            }`}
          >
            {FLOW_CATEGORY_LABEL[c]}
          </button>
        );
      })}
      <label className="ml-2 flex items-center gap-1 text-xs text-ink-2">
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
