"use client";

// "What are your Options?" grid for the Retirement Analysis Summary view.
//
// Three precomputed solved columns (streamed from the /options SSE) plus a live
// Explore column whose editable inputs build a SolverMutation map. Edits are
// debounced (600ms) then POSTed to /analysis/retirement/project; the resulting
// { years, summary } is lifted up via onExploreResult so the headline/KPI/chart
// /table recompute.
//
// Mirrors the solver's mutationMap + debounce pattern (live-solver-workspace)
// and the SSE-reading pattern (use-solver-solve).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProjectionYear } from "@/engine/types";
import type { RetirementSummary } from "@/lib/analysis/derive-retirement-summary";
import {
  mutationKey,
  type SolverMutation,
  type SolverMutationKey,
  type SolverSource,
} from "@/lib/solver/types";
import { formatCurrency } from "@/components/monte-carlo/lib/format";
import type {
  ExploreRow,
  SolvedColumnConfig,
  SolvedColumnId,
} from "./retirement/retirement-options-config";
import {
  SOLVED_COLUMNS,
  exploreRowToMutation,
} from "./retirement/retirement-options-config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ColumnStatus =
  | "pending"
  | "converged"
  | "not-achievable"
  // The solve stream errored or closed before this column reported.
  | "unavailable";

interface ColumnState {
  status: ColumnStatus;
  solvedValue: number | null;
  summary: RetirementSummary | null;
}

interface Props {
  clientId: string;
  source: SolverSource;
  /** Editable rows derived from the effective tree. */
  rows: ExploreRow[];
  /** Account the min-savings column targets + the SSE body field. */
  savingsAccountId: string;
  /** Lifts the latest Explore recompute (or null when the user resets). */
  onExploreResult: (
    result: { years: ProjectionYear[]; summary: RetirementSummary } | null,
  ) => void;
  /** Phase-4 save handlers — wired later. Optional no-ops for now. */
  onSaveScenario?: () => void;
  onSaveBaseFacts?: () => void;
}

// ---------------------------------------------------------------------------
// SSE parsing (mirrors use-solver-solve.parseSseStream)
// ---------------------------------------------------------------------------

interface ParsedEvent {
  event: string;
  data: string;
}

function* parseSseStream(buffer: string): Generator<ParsedEvent, string> {
  let cursor = 0;
  while (true) {
    const boundary = buffer.indexOf("\n\n", cursor);
    if (boundary === -1) return buffer.slice(cursor);
    const block = buffer.slice(cursor, boundary);
    cursor = boundary + 2;
    let eventName = "message";
    let data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event: ")) eventName = line.slice("event: ".length);
      else if (line.startsWith("data: ")) data += line.slice("data: ".length);
    }
    if (data) yield { event: eventName, data };
  }
}

interface ColumnEvent {
  column: SolvedColumnId;
  status: string;
  solvedValue: number | null;
  summary: RetirementSummary;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function fmtAgeLast(summary: RetirementSummary | null): string {
  if (summary === null) return "—";
  if (summary.fullyFunded || summary.ageAssetsLastUntil === null) return "Funded for life";
  const { client, spouse } = summary.ageAssetsLastUntil;
  return spouse === null ? `${client}` : `${client}/${spouse}`;
}

function fmtRowValue(row: ExploreRow, value: number): string {
  if (row.inputKind === "currency") return formatCurrency(value);
  return String(value);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AnalysisOptionsGrid({
  clientId,
  source,
  rows,
  savingsAccountId,
  onExploreResult,
  onSaveScenario,
  onSaveBaseFacts,
}: Props) {
  // --- Solved columns (streamed) ------------------------------------------
  const [columns, setColumns] = useState<Record<SolvedColumnId, ColumnState>>({
    "min-savings": { status: "pending", solvedValue: null, summary: null },
    "max-spending": { status: "pending", solvedValue: null, summary: null },
    "earliest-retirement": { status: "pending", solvedValue: null, summary: null },
  });

  useEffect(() => {
    if (!savingsAccountId) return; // nothing to solve against
    const ac = new AbortController();

    // Flip any column still in the skeleton to "unavailable" so it can't spin
    // forever after an error / early close. No-op for columns that reported.
    const settleStillPending = () =>
      setColumns((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const id of Object.keys(next) as SolvedColumnId[]) {
          if (next[id].status === "pending") {
            next[id] = { ...next[id], status: "unavailable" };
            changed = true;
          }
        }
        return changed ? next : prev;
      });

    (async () => {
      let res: Response;
      try {
        res = await fetch(
          `/api/clients/${clientId}/analysis/retirement/options`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ source, mutations: [], savingsAccountId }),
            signal: ac.signal,
          },
        );
      } catch {
        if (!ac.signal.aborted) settleStillPending();
        return; // aborted (unmount) or network failure
      }
      if (!res.ok || !res.body) {
        settleStillPending();
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const it = parseSseStream(buffer);
          let next = it.next();
          while (!next.done) {
            const ev = next.value;
            if (ev.event === "column") {
              const payload = JSON.parse(ev.data) as ColumnEvent;
              setColumns((prev) => ({
                ...prev,
                [payload.column]: {
                  status:
                    payload.status === "converged"
                      ? "converged"
                      : "not-achievable",
                  solvedValue: payload.solvedValue,
                  summary: payload.summary,
                },
              }));
            } else if (ev.event === "error") {
              // Server reported a fatal solve error — stop spinning.
              settleStillPending();
            }
            next = it.next();
          }
          buffer = next.value as string;
        }
        // Stream closed (done or error event). Any column the server never
        // reported on becomes "unavailable" rather than a perpetual skeleton.
        settleStillPending();
      } catch {
        // Aborted on unmount — leave state as-is. A genuine read failure that
        // isn't an unmount-abort should still settle the columns.
        if (!ac.signal.aborted) settleStillPending();
      }
    })();

    return () => ac.abort();
  }, [clientId, source, savingsAccountId]);

  // --- Explore column (live edits) ----------------------------------------
  const [mutationMap, setMutationMap] = useState<
    Map<SolverMutationKey, SolverMutation>
  >(() => new Map());
  const mutations = useMemo(() => Array.from(mutationMap.values()), [mutationMap]);
  const [exploreStatus, setExploreStatus] = useState<
    "fresh" | "computing" | "error"
  >("fresh");

  const pushEdit = useCallback((row: ExploreRow, value: number) => {
    const mutation = exploreRowToMutation(row, value);
    if (!mutation) return;
    setMutationMap((prev) => {
      const next = new Map(prev);
      next.set(mutationKey(mutation), mutation);
      return next;
    });
  }, []);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (mutations.length === 0) {
      setExploreStatus("fresh");
      onExploreResult(null);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const ac = new AbortController();
    debounceRef.current = setTimeout(async () => {
      setExploreStatus("computing");
      try {
        const res = await fetch(
          `/api/clients/${clientId}/analysis/retirement/project`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ source, mutations }),
            signal: ac.signal,
          },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as {
          years: ProjectionYear[];
          summary: RetirementSummary;
        };
        setExploreStatus("fresh");
        onExploreResult({ years: data.years, summary: data.summary });
      } catch {
        if (ac.signal.aborted) return;
        setExploreStatus("error");
      }
    }, 600);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      ac.abort();
    };
  }, [mutations, clientId, source, onExploreResult]);

  const hasEdits = mutations.length > 0;

  // A solved column is "applicable" only when the Explore row it highlights
  // actually exists for this client — otherwise its solved value would render
  // on no row (e.g. no editable pre-tax contribution → min-savings is N/A).
  const rowKeys = useMemo(() => new Set(rows.map((r) => r.key)), [rows]);

  // --- Render --------------------------------------------------------------
  return (
    <section
      aria-label="What are your options?"
      className="rounded border border-hair bg-card"
    >
      <header className="border-b border-hair px-[var(--pad-card)] py-3">
        <h3 className="text-[15px] font-semibold text-ink">
          What are your Options?
        </h3>
        <p className="mt-0.5 text-[12px] text-ink-4">
          Each column solves one lever so your plan is fully funded for life.
          Edit the Explore column to model your own changes.
        </p>
      </header>

      <div className="overflow-x-auto">
        <table className="min-w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th
                scope="col"
                className="border-b border-hair px-[var(--pad-card)] py-3 text-left text-[12px] font-semibold uppercase tracking-wider text-ink-2"
              >
                Lever
              </th>
              {SOLVED_COLUMNS.map((col) => (
                <SolvedColumnHeader
                  key={col.id}
                  config={col}
                  state={columns[col.id]}
                  applicable={rowKeys.has(col.highlightRow)}
                />
              ))}
              <th
                scope="col"
                className="border-b border-hair px-4 py-3 text-left align-bottom"
              >
                <div className="text-[13px] font-semibold text-ink">Explore</div>
                <div className="text-[11px] text-ink-4">Model your own changes</div>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="hover:bg-card-hover">
                <th
                  scope="row"
                  className="border-b border-hair px-[var(--pad-card)] py-2.5 text-left font-normal"
                >
                  <div className="text-[13px] text-ink">{row.label}</div>
                  <div className="text-[11px] text-ink-4">
                    Current:{" "}
                    {row.currentValue === null
                      ? "—"
                      : fmtRowValue(row, row.currentValue)}
                  </div>
                </th>
                {SOLVED_COLUMNS.map((col) => (
                  <SolvedCell
                    key={col.id}
                    row={row}
                    rows={rows}
                    config={col}
                    state={columns[col.id]}
                    applicable={rowKeys.has(col.highlightRow)}
                  />
                ))}
                <td className="border-b border-hair px-4 py-2.5">
                  <ExploreInput row={row} onCommit={(v) => pushEdit(row, v)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-hair px-[var(--pad-card)] py-3">
        <div className="text-[12px] text-ink-4" role="status">
          {exploreStatus === "computing"
            ? "Recomputing…"
            : exploreStatus === "error"
              ? "Recompute failed — try again."
              : hasEdits
                ? "Showing your explored changes above."
                : " "}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onSaveScenario}
            disabled={!hasEdits || !onSaveScenario}
            className="cursor-pointer rounded-[var(--radius-sm)] border border-hair bg-card-2 px-3 py-1.5 text-[12px] font-medium text-ink-2 transition-colors hover:border-accent/60 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            Save to Analysis
          </button>
          <button
            type="button"
            onClick={onSaveBaseFacts}
            disabled={!hasEdits || !onSaveBaseFacts}
            className="cursor-pointer rounded-[var(--radius-sm)] bg-accent px-3 py-1.5 text-[12px] font-medium text-accent-on transition-colors hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            Save to Base Facts
          </button>
        </div>
      </footer>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SolvedColumnHeader({
  config,
  state,
  applicable,
}: {
  config: SolvedColumnConfig;
  state: ColumnState;
  applicable: boolean;
}) {
  return (
    <th
      scope="col"
      className="border-b border-hair px-4 py-3 text-left align-bottom"
    >
      <div className="text-[13px] font-semibold text-ink">{config.title}</div>
      {!applicable ? (
        <div className="text-[11px] text-ink-4">Not applicable</div>
      ) : state.status === "pending" ? (
        <div
          className="mt-1 h-3 w-24 animate-pulse rounded bg-card-2"
          aria-label="Solving"
        />
      ) : state.status === "unavailable" ? (
        <div className="text-[11px] text-ink-4">Unavailable</div>
      ) : state.status === "not-achievable" ? (
        <div className="text-[11px] text-[color:var(--color-crit)]">
          Not achievable
        </div>
      ) : (
        <div className="text-[11px] text-ink-4">
          Assets last: {fmtAgeLast(state.summary)} ·{" "}
          {state.summary ? formatCurrency(state.summary.assetsRemaining) : "—"}{" "}
          remaining
        </div>
      )}
    </th>
  );
}

function SolvedCell({
  row,
  rows,
  config,
  state,
  applicable,
}: {
  row: ExploreRow;
  rows: ExploreRow[];
  config: SolvedColumnConfig;
  state: ColumnState;
  applicable: boolean;
}) {
  // Only highlight when the column applies — otherwise the solved lever has no
  // row to land on and every cell just shows its current value.
  const isHighlight = applicable && config.highlightRow === row.key;
  const currentDisplay =
    row.currentValue === null ? "—" : fmtRowValue(row, row.currentValue);

  // Non-applicable column, or skeleton/terminal states with nothing to show on
  // the highlighted cell: render the current value (or "—" on the highlight).
  if (!applicable) {
    return (
      <td className="border-b border-hair px-4 py-2.5 text-right tabular text-[13px] text-ink-3">
        {currentDisplay}
      </td>
    );
  }

  if (state.status === "pending") {
    return (
      <td className="border-b border-hair px-4 py-2.5">
        {isHighlight ? (
          <div
            className="h-4 w-16 animate-pulse rounded bg-card-2"
            aria-label="Solving"
          />
        ) : (
          <div className="text-right tabular text-[13px] text-ink-3">
            {currentDisplay}
          </div>
        )}
      </td>
    );
  }

  if (state.status === "not-achievable" || state.status === "unavailable") {
    return (
      <td className="border-b border-hair px-4 py-2.5 text-right tabular text-[13px] text-ink-4">
        {isHighlight ? "—" : currentDisplay}
      </td>
    );
  }

  // Converged: show the solved value only in the highlighted lever cell, using
  // the column's own formatter (e.g. multiplier → resulting spend). Other cells
  // keep their current value (the column changes one lever only).
  const display = isHighlight
    ? state.solvedValue === null
      ? "—"
      : (config.formatSolved(state.solvedValue, rows) ?? "—")
    : currentDisplay;

  return (
    <td
      className={
        "border-b border-hair px-4 py-2.5 text-right tabular text-[13px] " +
        (isHighlight
          ? "font-semibold text-[color:var(--color-good)] bg-[color:var(--color-good)]/10"
          : "text-ink-3")
      }
    >
      {display}
    </td>
  );
}

function ExploreInput({
  row,
  onCommit,
}: {
  row: ExploreRow;
  onCommit: (value: number) => void;
}) {
  const isCurrency = row.inputKind === "currency";
  const min = row.inputKind === "age" ? 40 : row.inputKind === "year" ? 1900 : 0;
  const max =
    row.inputKind === "age" ? 100 : row.inputKind === "year" ? 2200 : undefined;
  const inputId = `explore-${row.key}`;

  if (isCurrency) {
    return (
      <CurrencyInput
        id={inputId}
        label={row.label}
        defaultValue={row.currentValue ?? 0}
        onCommit={onCommit}
      />
    );
  }

  return (
    <input
      id={inputId}
      type="number"
      min={min}
      max={max}
      defaultValue={row.currentValue ?? undefined}
      onChange={(e) => {
        const n = parseInt(e.target.value, 10);
        if (Number.isNaN(n)) return;
        if (n < min) return;
        if (max !== undefined && n > max) return;
        onCommit(n);
      }}
      aria-label={`Explore ${row.label}`}
      className="h-9 w-24 cursor-pointer rounded-[var(--radius-sm)] border border-hair bg-card-2 px-2.5 text-[14px] text-ink tabular border-l-2 border-l-accent/70 focus:cursor-text focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
    />
  );
}

function CurrencyInput({
  id,
  label,
  defaultValue,
  onCommit,
}: {
  id: string;
  label: string;
  defaultValue: number;
  onCommit: (value: number) => void;
}) {
  const [display, setDisplay] = useState<string>(
    Math.round(defaultValue).toLocaleString(),
  );
  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value.replace(/[^\d]/g, "");
    const n = raw === "" ? 0 : parseInt(raw, 10);
    if (Number.isNaN(n) || n < 0) return;
    setDisplay(n.toLocaleString());
    onCommit(n);
  }
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[13px] text-ink-3">
        $
      </span>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        value={display}
        onChange={handleChange}
        aria-label={`Explore ${label}`}
        className="h-9 w-28 cursor-pointer rounded-[var(--radius-sm)] border border-hair bg-card-2 pl-6 pr-2.5 text-[14px] text-ink tabular border-l-2 border-l-accent/70 focus:cursor-text focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
      />
    </div>
  );
}
