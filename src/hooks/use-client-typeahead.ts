"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { ClientSearchResult } from "@/lib/client-search";

/**
 * Debounced roster typeahead against `/api/clients/search`.
 *
 * Owns the query/results/highlight state, the debounce + abort plumbing, and
 * the listbox keyboard contract; the caller owns the markup and what a pick
 * means. Two callers today: the sidebar search (navigates to the client) and
 * the intake sender (fills the recipient from the picked household).
 */

const DEBOUNCE_MS = 200;

export interface ClientTypeahead {
  query: string;
  setQuery: (next: string) => void;
  results: ClientSearchResult[];
  open: boolean;
  highlighted: number;
  setHighlighted: (index: number) => void;
  /** Re-open on focus, but only when there's something to show. */
  reopen: () => void;
  /** Commit a result: hands it to `onPick`, then clears the search. */
  pick: (hit: ClientSearchResult) => void;
  handleKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
}

export function useClientTypeahead(
  onPick: (hit: ClientSearchResult) => void,
): ClientTypeahead {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ClientSearchResult[]>([]);
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

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/clients/search?q=${encodeURIComponent(trimmed)}`, {
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error("search failed");
        const data = (await res.json()) as ClientSearchResult[];
        setResults(data);
        setHighlighted(0);
        setOpen(true);
      } catch {
        // An abort is us superseding this search (next keystroke, or the
        // picker going away) — leave the state for whoever superseded it.
        if (ctrl.signal.aborted) return;
        setResults([]);
        setOpen(false);
      }
    }, DEBOUNCE_MS);

    // Covers both "kept typing" and "component unmounted mid-flight": the
    // latter happens here on every pick, since picking swaps the picker out.
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [query]);

  function pick(hit: ClientSearchResult) {
    onPick(hit);
    setQuery("");
    setResults([]);
    setOpen(false);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, Math.max(0, results.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      // Never let picking a result submit a form the input sits inside.
      e.preventDefault();
      const picked = results[highlighted];
      if (picked) pick(picked);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return {
    query,
    setQuery,
    results,
    open,
    highlighted,
    setHighlighted,
    reopen: () => {
      if (results.length > 0) setOpen(true);
    },
    pick,
    handleKeyDown,
  };
}
