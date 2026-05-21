"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { inputClassName, fieldLabelClassName } from "@/components/forms/input-styles";
import { AlertCircleIcon, SearchIcon } from "@/components/icons";
import { getPrimaryContact } from "@/lib/crm/selectors";

/**
 * Search-as-you-type combobox for picking an existing CRM household to bind a
 * new planning client to. Used by /clients/new step 1.
 *
 * Behavior:
 *   - Minimum 2 chars before firing a search (typing 1 char is almost never
 *     useful and hammers the API).
 *   - 250ms debounce + AbortController so an in-flight request is cancelled
 *     when the user keeps typing.
 *   - Shows up to 10 results; each row exposes household name + primary
 *     contact name + status.
 *   - Selecting an option calls onSelect(householdId). The parent owns the
 *     selection state — this component just emits the id.
 *   - A "Create new CRM household" link sits below the list and carries
 *     `returnTo` so the CRM new-household form can navigate back here after
 *     creation.
 */

type PickerContact = {
  role: "primary" | "spouse" | "dependent" | "other";
  firstName: string;
  lastName: string;
  // Selector's HouseholdLike expects [key: string]: unknown — the API returns
  // more fields than we render but we don't care about them here.
  [key: string]: unknown;
};

interface PickerHousehold {
  id: string;
  name: string;
  status: "prospect" | "active" | "inactive" | "archived";
  contacts: PickerContact[];
}

interface CrmHouseholdPickerProps {
  onSelect: (householdId: string) => void;
  /** Where the "+ Create new CRM household" link should send the user back to
   *  after they finish creating in CRM. The CRM new-household form will
   *  redirect here with `?crmHouseholdId=...` appended. */
  returnTo?: string;
}

const STATUS_LABELS: Record<PickerHousehold["status"], string> = {
  prospect: "Prospect",
  active: "Active",
  inactive: "Inactive",
  archived: "Archived",
};

export function CrmHouseholdPicker({ onSelect, returnTo }: CrmHouseholdPickerProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PickerHousehold[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // Cleanup any pending timer / request on unmount.
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (abortRef.current) abortRef.current.abort();
    setError(null);

    if (query.trim().length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    timerRef.current = setTimeout(async () => {
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const params = new URLSearchParams({ search: query.trim(), limit: "10" });
        const res = await fetch(`/api/crm/households?${params.toString()}`, {
          signal: controller.signal,
          headers: { accept: "application/json" },
        });
        if (!res.ok) {
          throw new Error(`Search failed (${res.status})`);
        }
        const json = (await res.json()) as { households: PickerHousehold[] };
        // Defensive: server returns whatever it pleases; we only show what's
        // shape-compatible with our row renderer.
        setResults(Array.isArray(json.households) ? json.households.slice(0, 10) : []);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Search failed");
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
  }, [query]);

  const createHref = returnTo
    ? `/crm/new?returnTo=${encodeURIComponent(returnTo)}`
    : "/crm/new";

  const showEmptyHint = touched && query.trim().length >= 2 && !loading && results.length === 0 && !error;

  return (
    <div className="space-y-3">
      <div>
        <label className={fieldLabelClassName} htmlFor="crm-household-picker">
          CRM household
        </label>
        <div className="relative">
          <SearchIcon
            width={14}
            height={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-4"
            aria-hidden="true"
          />
          <input
            id="crm-household-picker"
            type="search"
            autoComplete="off"
            placeholder="Search households by name…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setTouched(true);
            }}
            className={`${inputClassName} pl-9`}
            aria-controls="crm-household-picker-results"
          />
        </div>
        <p className="mt-1.5 text-[12px] text-ink-4">
          Identity (name, DOB, email, address) lives in the CRM. Pick the household this client belongs to.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-crit/30 bg-crit/10 px-3 py-2 text-[13px] text-crit"
        >
          <AlertCircleIcon width={16} height={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      <ul
        id="crm-household-picker-results"
        className="divide-y divide-hair overflow-hidden rounded-[var(--radius-sm)] border border-hair bg-card-2 empty:hidden"
        role="listbox"
      >
        {results.map((h) => {
          const primary = getPrimaryContact(h);
          const primaryLabel = primary ? `${primary.firstName} ${primary.lastName}` : null;
          return (
            <li key={h.id}>
              <button
                type="button"
                onClick={() => onSelect(h.id)}
                className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-card"
                role="option"
                aria-selected={false}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium text-ink">{h.name}</span>
                  {primaryLabel && (
                    <span className="block truncate text-[12px] text-ink-3">{primaryLabel}</span>
                  )}
                </span>
                <span className="shrink-0 rounded-full border border-hair px-2 py-0.5 text-[11px] uppercase tracking-wide text-ink-3">
                  {STATUS_LABELS[h.status]}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {loading && (
        <p className="text-[12px] text-ink-4" aria-live="polite">Searching…</p>
      )}

      {showEmptyHint && (
        <p className="text-[12px] text-ink-4">No households match &ldquo;{query.trim()}&rdquo;.</p>
      )}

      <div className="pt-1">
        <Link
          href={createHref}
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-accent-ink transition-colors hover:text-accent-deep"
        >
          + Create new CRM household
        </Link>
      </div>
    </div>
  );
}
