// src/components/forms/security-search-dialog.tsx
"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import DialogShell from "@/components/dialog-shell";
import { SearchIcon } from "@/components/icons";
import { inputClassName } from "./input-styles";
import { searchSecurities, type SecuritySearchHit } from "@/lib/investments/holdings-client";

/**
 * Find a security's ticker from its name.
 *
 * The case it exists for: a statement lists "Vanguard Total Stock Market Index
 * Fund Admiral Shares" and no symbol anywhere on the page. Every other holdings
 * control is keyed on a ticker the advisor is assumed to already have.
 *
 * A dialog rather than an inline dropdown because the row trigger sits inside
 * the holdings table's own scroll box, which would clip a popover — the same
 * reason the asset-class editor is a dialog.
 */

/** Mirrors `MIN_SEARCH_QUERY` on the server (see search-securities.ts, and the
 *  `.min()` on `securitySearchSchema`). Restated rather than imported so this
 *  client component doesn't pull the classification modules into the bundle. */
const MIN_QUERY = 2;

const TYPE_LABELS: Record<string, string> = {
  etf: "ETF",
  mutual_fund: "Fund",
  stock: "Stock",
  bond: "Bond",
};

/** Matches the holdings table's own price format. An unpriced row shows an
 *  em dash, never $0.00 — "we couldn't price this" and "this is worth nothing"
 *  must not look the same. */
const fmtPrice = (price: number | undefined) =>
  typeof price === "number" && Number.isFinite(price)
    ? `$${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`
    : "—";

interface Props {
  clientId: string;
  /** Seeds the box — whatever name or ticker the row already carries, so the
   *  common case is one click and a pick, with nothing to retype. */
  seed: string;
  onPick: (hit: SecuritySearchHit) => void;
  onClose: () => void;
}

export function SecuritySearchDialog({ clientId, seed, onPick, onClose }: Props) {
  const [query, setQuery] = useState(seed);
  const [results, setResults] = useState<SecuritySearchHit[]>([]);
  /** The widened query the server fell back to, when the typed name found
   *  nothing on its own. Shown rather than hidden: otherwise the list looks
   *  like it ignored half of what was typed. */
  const [relaxedTo, setRelaxedTo] = useState<string | null>(null);
  // Starts true when the seed is already searchable: the debounce effect hasn't
  // run yet on first paint, and an empty `results` would otherwise read as
  // "nothing matches" for a moment.
  const [loading, setLoading] = useState(seed.trim().length >= MIN_QUERY);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    abort.current?.abort();
  }, []);

  // Debounced search. The seeded query runs on open, so a row that already
  // holds a name shows its candidates without the advisor typing anything.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    abort.current?.abort();
    setError(null);

    const q = query.trim();
    if (q.length < MIN_QUERY) {
      setResults([]);
      setRelaxedTo(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    timer.current = setTimeout(async () => {
      const controller = new AbortController();
      abort.current = controller;
      try {
        const { hits, relaxedTo: widened } = await searchSecurities(clientId, q, controller.signal);
        setResults(hits);
        setRelaxedTo(widened);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setResults([]);
        setRelaxedTo(null);
        setError(err instanceof Error ? err.message : "Search failed.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);
  }, [query, clientId]);

  function pick(hit: SecuritySearchHit) {
    onPick(hit);
    onClose();
  }

  /** This dialog renders inside the account form's DOM, so a bare Enter would
   *  submit that form. Enter takes the top match instead — which is the match
   *  in almost every search that found anything. */
  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (results.length > 0) pick(results[0]);
  }

  // One line at a time, in priority order. Three independent conditionals raced
  // each other and needed a fourth piece of state to keep them apart.
  const hint =
    query.trim().length < MIN_QUERY ? `Type at least ${MIN_QUERY} characters.`
    : loading ? "Searching…"
    : error ? null
    : relaxedTo && results.length > 0
      ? `No exact match \u2014 showing the closest to \u201C${relaxedTo}\u201D.`
    : results.length > 0 ? null
    : `Nothing matches \u201C${query.trim()}\u201D. Try fewer words, or the fund family name.`;

  return (
    <DialogShell
      open
      onOpenChange={(next) => { if (!next) onClose(); }}
      title="Find a security"
      // `md`, not `sm`: a European fund's identifier is the full ISIN plus an
      // exchange suffix (GB0033772624.EUFUND), which overran the ticker column
      // and printed on top of the name at 480px.
      size="md"
      secondaryAction={{ label: "Cancel", onClick: onClose }}
    >
      <div className="space-y-3">
        <div className="relative">
          <SearchIcon
            width={14}
            height={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-4"
            aria-hidden="true"
          />
          <input
            type="text"
            aria-label="Security name or ticker"
            data-autofocus=""
            autoComplete="off"
            placeholder="Fund or company name, or a ticker…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={handleKeyDown}
            className={`${inputClassName} pl-9`}
          />
        </div>

        {error && (
          <p role="alert" className="rounded-[var(--radius-sm)] border border-crit/30 bg-crit/10 px-3 py-2 text-xs text-crit">
            {error}
          </p>
        )}

        <ul
          className="divide-y divide-hair overflow-hidden rounded-[var(--radius-sm)] border border-hair bg-card-2 empty:hidden"
          role="listbox"
          aria-label="Matching securities"
        >
          {results.map((hit) => (
            <li key={`${hit.ticker}-${hit.exchange}`}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => pick(hit)}
                className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-card-hover"
              >
                {/* Both columns clip rather than wrap — a picker reads as a list
                    only while every row is one line high. `title` is what makes
                    the clipped half recoverable: the ISIN's tail here, and the
                    share class ("… Instl Class") that distinguishes two
                    otherwise identical fund names there. */}
                <span
                  className="tabular w-[124px] shrink-0 truncate text-[13px] font-medium text-ink"
                  title={hit.ticker}
                >
                  {hit.ticker}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2" title={hit.name}>
                  {hit.name}
                </span>
                <span
                  className={`tabular shrink-0 text-right text-[13px] ${
                    hit.price === undefined ? "text-ink-4" : "text-ink-2"
                  }`}
                >
                  {fmtPrice(hit.price)}
                </span>
                <span className="shrink-0 rounded-full border border-hair px-2 py-0.5 text-[11px] text-ink-3">
                  {TYPE_LABELS[hit.securityType] ?? hit.exchange}
                </span>
              </button>
            </li>
          ))}
        </ul>

        {hint && <p className="text-xs text-ink-4" aria-live="polite">{hint}</p>}
      </div>
    </DialogShell>
  );
}

/** The magnifier that opens the picker. Sized and coloured to sit quietly
 *  beside a ticker rather than compete with it — but on `ink-3`, not the `ink-4`
 *  the decorative in-field magnifiers use: this one is the feature's only
 *  affordance, so it owes WCAG's 3:1 for non-text. Measured on the real painted
 *  surfaces, `ink-4` clears it in Dark (4.86) and Light (4.66) and MISSES in
 *  Industrial (2.98 add row / 2.79 table row); `ink-3` clears all three. */
export function SecuritySearchTrigger({
  onClick, label, className = "",
}: {
  onClick: () => void;
  label: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`shrink-0 text-ink-3 transition-colors hover:text-accent-ink ${className}`}
    >
      <SearchIcon width={14} height={14} aria-hidden="true" />
    </button>
  );
}
