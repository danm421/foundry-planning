"use client";

import { useEffect, useRef, useState } from "react";
import DialogShell from "@/components/dialog-shell";
import {
  inputClassName,
  selectClassName,
  fieldLabelClassName,
} from "@/components/forms/input-styles";
import { AlertCircleIcon, SearchIcon } from "@/components/icons";
import { RELATIONSHIP_PICKER_OPTIONS } from "@/lib/crm/relationship-labels";
import { HOUSEHOLD_STATUS_LABELS } from "@/components/household-status-select";

type SearchResultHousehold = {
  id: string;
  name: string;
  status: string;
};

interface Props {
  householdId: string;
  /** Self + already-linked counterpart ids — filtered out of search results. */
  excludeIds: string[];
  open: boolean;
  onClose: () => void;
  onLinked: () => void;
}

const FORM_ID = "crm-link-household-form";

export function CrmLinkHouseholdDialog({ householdId, excludeIds, open, onClose, onLinked }: Props) {
  const [query, setQuery] = useState("");
  const [rawResults, setRawResults] = useState<SearchResultHousehold[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<SearchResultHousehold | null>(null);
  const [relationshipValue, setRelationshipValue] = useState(RELATIONSHIP_PICKER_OPTIONS[0].value);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Every open is a fresh start — clear whatever the last open left behind
  // (search text, selection, error) rather than carrying it forward.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setRawResults([]);
    setSelected(null);
    setRelationshipValue(RELATIONSHIP_PICKER_OPTIONS[0].value);
    setNote("");
    setError(null);
  }, [open]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (abortRef.current) abortRef.current.abort();

    if (query.trim().length < 2) {
      setRawResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    timerRef.current = setTimeout(async () => {
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const params = new URLSearchParams({ search: query.trim(), limit: "20" });
        const res = await fetch(`/api/crm/households?${params.toString()}`, {
          signal: controller.signal,
          headers: { accept: "application/json" },
        });
        if (!res.ok) throw new Error(`Search failed (${res.status})`);
        const json = (await res.json()) as { households: SearchResultHousehold[] };
        setRawResults(Array.isArray(json.households) ? json.households : []);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setRawResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
  }, [query]);

  // Filtered at render time (not in the fetch effect) so a change to
  // `excludeIds` alone — the parent recomputes it fresh every render — never
  // re-triggers a search.
  const results = rawResults.filter((h) => !excludeIds.includes(h.id));
  const selectedOption =
    RELATIONSHIP_PICKER_OPTIONS.find((o) => o.value === relationshipValue) ??
    RELATIONSHIP_PICKER_OPTIONS[0];

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selected) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/crm/households/${householdId}/relationships`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          counterpartHouseholdId: selected.id,
          type: selectedOption.type,
          viewerSide: selectedOption.viewerSide,
          note: note.trim() ? note.trim() : undefined,
        }),
      });
      if (!res.ok) {
        if (res.status === 409) {
          throw new Error("These households are already linked.");
        }
        const j = await res.json().catch(() => ({}));
        throw new Error(typeof j.error === "string" ? j.error : `Link failed (${res.status})`);
      }
      onLinked();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Link failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <DialogShell
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="Link household"
      size="md"
      primaryAction={{
        label: submitting ? "Linking…" : "Link household",
        form: FORM_ID,
        loading: submitting,
        disabled: !selected,
      }}
    >
      <form id={FORM_ID} onSubmit={onSubmit} className="space-y-4">
        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-crit/30 bg-crit/10 px-3 py-2 text-[13px] text-crit"
          >
            <AlertCircleIcon width={16} height={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {selected ? (
          <div>
            <p className={fieldLabelClassName}>Household</p>
            <div className="flex items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-hair bg-card-2 px-3 py-2">
              <span className="min-w-0 truncate text-[14px] font-medium text-ink">{selected.name}</span>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="shrink-0 text-[12px] font-medium text-accent-ink transition-colors hover:text-accent-deep"
              >
                Change
              </button>
            </div>
          </div>
        ) : (
          <div>
            <label className={fieldLabelClassName} htmlFor="link-household-search">
              Household
            </label>
            <div className="relative">
              <SearchIcon
                width={14}
                height={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-4"
                aria-hidden="true"
              />
              <input
                id="link-household-search"
                type="search"
                autoComplete="off"
                placeholder="Search households by name…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className={`${inputClassName} pl-9`}
                aria-controls="link-household-results"
              />
            </div>

            {searching && (
              <p className="mt-1.5 text-[12px] text-ink-4" aria-live="polite">Searching…</p>
            )}

            <ul
              id="link-household-results"
              role="listbox"
              className="mt-2 divide-y divide-hair overflow-hidden rounded-[var(--radius-sm)] border border-hair bg-card-2 empty:hidden"
            >
              {results.map((h) => (
                <li key={h.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(h)}
                    role="option"
                    aria-selected={false}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-card"
                  >
                    <span className="min-w-0 truncate text-[14px] font-medium text-ink">{h.name}</span>
                    <span className="shrink-0 rounded-full border border-hair px-2 py-0.5 text-[11px] uppercase tracking-wide text-ink-3">
                      {(HOUSEHOLD_STATUS_LABELS as Record<string, string>)[h.status] ?? h.status}
                    </span>
                  </button>
                </li>
              ))}
            </ul>

            {!searching && query.trim().length >= 2 && results.length === 0 && (
              <p className="mt-1.5 text-[12px] text-ink-4">
                No households match &ldquo;{query.trim()}&rdquo;.
              </p>
            )}
          </div>
        )}

        <div>
          <label className={fieldLabelClassName} htmlFor="link-relationship-type">
            Relationship
          </label>
          <select
            id="link-relationship-type"
            value={relationshipValue}
            onChange={(e) => setRelationshipValue(e.target.value)}
            className={selectClassName}
          >
            {RELATIONSHIP_PICKER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={fieldLabelClassName} htmlFor="link-note">
            Note (optional)
          </label>
          <input
            id="link-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={200}
            className={inputClassName}
          />
        </div>
      </form>
    </DialogShell>
  );
}
