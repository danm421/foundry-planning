// src/components/tax-ledger/tax-ledger-filters.tsx
"use client";

import { CHARACTER_LABEL, type TaxCharacter } from "@/lib/tax-ledger";

export interface LedgerFilterState {
  characters: Set<TaxCharacter>; // empty = show all
  hideNonTaxable: boolean;
  hideZero: boolean;
}

const ALL_CHARACTERS: TaxCharacter[] = [
  "earned", "ordinary", "qualified_dividends", "long_term_gain",
  "short_term_gain", "tax_exempt", "social_security", "deduction",
];

export default function TaxLedgerFilters({
  state,
  onChange,
}: {
  state: LedgerFilterState;
  onChange: (next: LedgerFilterState) => void;
}) {
  function toggleCharacter(c: TaxCharacter) {
    const next = new Set(state.characters);
    if (next.has(c)) next.delete(c);
    else next.add(c);
    onChange({ ...state, characters: next });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {ALL_CHARACTERS.map((c) => {
        const active = state.characters.size === 0 || state.characters.has(c);
        return (
          <button
            key={c}
            type="button"
            onClick={() => toggleCharacter(c)}
            className={`rounded-full border px-2.5 py-1 text-xs ${
              active ? "border-accent bg-accent/10 text-ink" : "border-hair bg-card text-ink-3"
            }`}
          >
            {CHARACTER_LABEL[c]}
          </button>
        );
      })}
      <label className="ml-2 flex items-center gap-1 text-xs text-ink-2">
        <input type="checkbox" checked={state.hideNonTaxable} onChange={(e) => onChange({ ...state, hideNonTaxable: e.target.checked })} />
        Hide non-taxable
      </label>
      <label className="flex items-center gap-1 text-xs text-ink-2">
        <input type="checkbox" checked={state.hideZero} onChange={(e) => onChange({ ...state, hideZero: e.target.checked })} />
        Hide zero rows
      </label>
    </div>
  );
}
