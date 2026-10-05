"use client";

import { useClientTypeahead } from "@/hooks/use-client-typeahead";
import type { ClientSearchResult } from "@/lib/client-search";

const inputCls =
  "w-full rounded-[var(--radius-sm)] border border-hair bg-card-2 px-3 py-3 text-[14px] text-ink outline-none transition-colors placeholder:text-ink-4 hover:border-hair-2 focus:border-accent focus:ring-1 focus:ring-accent";
const labelCls = "mb-1.5 block text-[12px] font-medium text-ink-2";

/**
 * Roster search for Data Collection: the send card picks who a form goes to,
 * the review screen picks which existing client a new-household form belongs to.
 */
export function ClientPicker({ onPick }: { onPick: (hit: ClientSearchResult) => void }) {
  const { query, setQuery, results, open, highlighted, setHighlighted, reopen, pick, handleKeyDown } =
    useClientTypeahead(onPick);

  return (
    <div className="relative">
      <label htmlFor="intake-client-search" className={labelCls}>
        Client
      </label>
      <input
        id="intake-client-search"
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={reopen}
        placeholder="Search clients…"
        className={inputCls}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls="intake-client-listbox"
      />
      {open ? (
        <ul
          id="intake-client-listbox"
          role="listbox"
          className="absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-[var(--radius-md)] border border-hair-2 bg-card-2 shadow-lg shadow-black/20"
        >
          {results.length === 0 ? (
            <li className="px-3 py-2 text-[13px] text-ink-4">No matches</li>
          ) : (
            results.map((r, i) => (
              <li
                key={r.id}
                role="option"
                aria-selected={i === highlighted}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(r);
                }}
                onMouseEnter={() => setHighlighted(i)}
                className={`cursor-pointer px-3 py-2 text-[13px] ${
                  i === highlighted ? "bg-card-hover text-ink" : "text-ink-2"
                }`}
              >
                {r.householdTitle}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
