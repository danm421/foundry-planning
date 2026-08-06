"use client";

import { useRouter } from "next/navigation";
import type { ReactElement } from "react";
import { useClientTypeahead } from "@/hooks/use-client-typeahead";
import { SearchIcon } from "./icons";

export default function ClientSearch(): ReactElement {
  const router = useRouter();
  const { query, setQuery, results, open, highlighted, setHighlighted, reopen, pick, handleKeyDown } =
    useClientTypeahead((hit) => router.push(`/clients/${hit.id}/details`));

  return (
    <div className="relative px-[var(--pad-card)] py-2">
      <div className="flex items-center gap-2 rounded bg-card border border-hair px-2 py-1.5">
        <SearchIcon className="text-ink-4" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={reopen}
          placeholder="Search clients…"
          className="w-full bg-transparent text-[13px] text-ink placeholder:text-ink-4 focus:outline-none"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls="client-search-listbox"
          role="combobox"
        />
      </div>
      {open ? (
        <ul
          id="client-search-listbox"
          role="listbox"
          className="absolute left-[var(--pad-card)] right-[var(--pad-card)] top-full mt-1 rounded bg-card-2 border border-ink-3 shadow-lg overflow-hidden z-30"
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
                className={`px-3 py-2 text-[13px] cursor-pointer ${
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
