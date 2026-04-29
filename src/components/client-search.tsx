"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ReactElement } from "react";
import { SearchIcon } from "./icons";

interface SearchResult {
  id: string;
  householdTitle: string;
}

const DEBOUNCE_MS = 200;

export default function ClientSearch(): ReactElement {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      setResults([]);
      setOpen(false);
      return;
    }

    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const res = await fetch(`/api/clients/search?q=${encodeURIComponent(trimmed)}`, {
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error("search failed");
        const data = (await res.json()) as SearchResult[];
        setResults(data);
        setHighlighted(0);
        setOpen(true);
      } catch {
        setResults([]);
        setOpen(false);
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, Math.max(0, results.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const picked = results[highlighted];
      if (picked) {
        router.push(`/clients/${picked.id}/overview`);
        setQuery("");
        setOpen(false);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="relative px-[var(--pad-card)] py-2">
      <div className="flex items-center gap-2 rounded bg-card border border-hair px-2 py-1.5">
        <SearchIcon className="text-ink-4" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (results.length > 0) setOpen(true); }}
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
          className="absolute left-[var(--pad-card)] right-[var(--pad-card)] top-full mt-1 rounded bg-card-2 border border-ink-4 shadow-lg overflow-hidden z-30"
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
                  router.push(`/clients/${r.id}/overview`);
                  setQuery("");
                  setOpen(false);
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
