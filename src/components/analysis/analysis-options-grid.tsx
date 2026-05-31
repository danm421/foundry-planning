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
import { TaxDetailTooltip } from "@/components/cashflow/tax-detail-tooltip";
import type { MinSavingsGrowth } from "@/lib/analysis/hypothetical-savings";
import type {
  ExploreRow,
  ModelPortfolioOption,
  SolvedColumnConfig,
  SolvedColumnId,
} from "./retirement/retirement-options-config";
import {
  SOLVED_COLUMNS,
  exploreRowToMutation,
} from "./retirement/retirement-options-config";

const TAXABLE_DEFAULT_VALUE = "taxable-default";
const CUSTOM_VALUE = "custom";

/** The Explore row the Minimum Additional Savings column highlights — the row the
 *  inline growth control renders on. */
const MIN_SAVINGS_ROW_KEY =
  SOLVED_COLUMNS.find((c) => c.id === "min-savings")?.highlightRow ?? "taxable-contributions";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ColumnStatus =
  | "pending"
  | "converged"
  | "not-achievable"
  // The solve stream errored or closed before this column reported.
  | "unavailable";

/** Min-savings funding-source detail (present only on that column). */
interface FundingSource {
  /** Largest single-year reduction in living expenses across the horizon. */
  maxExpenseReduction: number;
  /** Pre-formatted growth-assumption label (e.g. "Balanced — 6.2%"). */
  growthLabel: string;
}

interface ColumnState {
  status: ColumnStatus;
  solvedValue: number | null;
  summary: RetirementSummary | null;
  fundingSource: FundingSource | null;
}

interface Props {
  clientId: string;
  source: SolverSource;
  /** Editable rows derived from the effective tree. */
  rows: ExploreRow[];
  /** Non-empty when there is an account to anchor the min-savings row — used
   *  only as a local "is there anything to solve" gate (the solve itself
   *  targets a server-injected synthetic taxable account). */
  savingsAccountId: string;
  /** Growth assumption for the hypothetical taxable savings the min-savings
   *  column solves. Changing it re-runs the solve. */
  minSavingsGrowth: MinSavingsGrowth;
  /** Firm model portfolios for the in-cell growth picker. */
  modelPortfolioOptions: ModelPortfolioOption[];
  /** Updates the growth assumption when the advisor picks a portfolio inline. */
  onMinSavingsGrowthChange: (next: MinSavingsGrowth) => void;
  /** Lifts the latest Explore recompute (or null when the user resets). */
  onExploreResult: (
    result: { years: ProjectionYear[]; summary: RetirementSummary } | null,
  ) => void;
  /** Save handlers provided by the orchestrator; buttons disabled until there are Explore edits / while a save is in flight. */
  onSaveScenario?: () => void;
  /** True while the save-scenario POST is in-flight — button shows pending state. */
  savingScenario?: boolean;
  onSaveBaseFacts?: () => void;
  /** True while the save-to-base POST is in-flight — button shows pending state. */
  savingBaseFacts?: boolean;
  /** Lifted so the parent can re-use the current Explore mutations (e.g. PoS fetch). */
  onMutationsChange?: (mutations: SolverMutation[]) => void;
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
  fundingSource?: FundingSource;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function fmtAgeLast(summary: RetirementSummary | null): string {
  if (summary === null) return "—";
  if (summary.fullyFunded || summary.ageAssetsLastUntil === null) return "Funded for life";
  const { client, spouse } = summary.ageAssetsLastUntil;
  return spouse === null ? `Age ${client}` : `Age ${client}/${spouse}`;
}

/** Compact currency for the dense column-header subtitles ($5,008,516 → $5.0M).
 *  The exact figure is surfaced via a title tooltip on the subtitle. */
function fmtCompactCurrency(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}K`;
  return `${sign}$${Math.round(abs)}`;
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
  minSavingsGrowth,
  onMinSavingsGrowthChange,
  modelPortfolioOptions,
  onExploreResult,
  onSaveScenario,
  savingScenario = false,
  onSaveBaseFacts,
  savingBaseFacts = false,
  onMutationsChange,
}: Props) {
  // --- Solved columns (streamed) ------------------------------------------
  const [columns, setColumns] = useState<Record<SolvedColumnId, ColumnState>>({
    "min-savings": { status: "pending", solvedValue: null, summary: null, fundingSource: null },
    "max-spending": { status: "pending", solvedValue: null, summary: null, fundingSource: null },
    "earliest-retirement": { status: "pending", solvedValue: null, summary: null, fundingSource: null },
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
            body: JSON.stringify({
              source,
              mutations: [],
              minSavingsGrowth,
            }),
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
                  fundingSource: payload.fundingSource ?? null,
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
    // minSavingsGrowth is a stable state object from the parent; only a picker
    // change gives it a new identity, which re-runs the solve.
  }, [clientId, source, savingsAccountId, minSavingsGrowth]);

  // --- Explore column (live edits) ----------------------------------------
  const [mutationMap, setMutationMap] = useState<
    Map<SolverMutationKey, SolverMutation>
  >(() => new Map());
  const mutations = useMemo(() => Array.from(mutationMap.values()), [mutationMap]);

  // Lift mutations to parent (e.g. for PoS fetch) whenever they change.
  useEffect(() => {
    onMutationsChange?.(mutations);
  }, [mutations, onMutationsChange]);

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
            body: JSON.stringify({ source, mutations, minSavingsGrowth }),
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
  }, [mutations, clientId, source, onExploreResult, minSavingsGrowth]);

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
      <header className="flex items-center gap-1.5 border-b border-hair px-[var(--pad-card)] py-3">
        <h3 className="text-[15px] font-semibold text-ink">
          What are your Options?
        </h3>
        <TaxDetailTooltip
          iconLabel="What these columns mean"
          text="Each column solves one lever so your plan is fully funded for life. Edit the Explore column to model your own changes."
        />
      </header>

      <div className="overflow-x-auto">
        <table className="min-w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th
                scope="col"
                className="w-[200px] min-w-[200px] border-b border-hair px-[var(--pad-card)] py-3 text-left text-[12px] font-semibold uppercase tracking-wider text-ink-2"
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
                className="border-b border-l border-hair bg-card-2/30 px-4 py-3 text-left align-bottom"
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
                  <div className="whitespace-nowrap text-[13px] text-ink">{row.label}</div>
                  <div className="text-[11px] text-ink-4">
                    Current:{" "}
                    {row.currentValue === null
                      ? "—"
                      : fmtRowValue(row, row.currentValue)}
                  </div>
                  {row.key === MIN_SAVINGS_ROW_KEY && (
                    <MinSavingsGrowthControl
                      options={modelPortfolioOptions}
                      value={minSavingsGrowth}
                      onChange={onMinSavingsGrowthChange}
                    />
                  )}
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
                <td className="border-b border-l border-hair bg-card-2/30 px-4 py-2.5">
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
            disabled={!hasEdits || !onSaveScenario || savingScenario}
            className="cursor-pointer rounded-[var(--radius-sm)] border border-hair bg-card-2 px-3 py-1.5 text-[12px] font-medium text-ink-2 transition-colors hover:border-accent/60 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            {savingScenario ? "Saving…" : "Save to Analysis"}
          </button>
          <button
            type="button"
            onClick={onSaveBaseFacts}
            disabled={!hasEdits || !onSaveBaseFacts || savingBaseFacts}
            className="cursor-pointer rounded-[var(--radius-sm)] bg-accent px-3 py-1.5 text-[12px] font-medium text-accent-on transition-colors hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            {savingBaseFacts ? "Saving…" : "Save to Base Facts"}
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
      className="border-b border-hair px-4 py-3 text-right align-bottom"
    >
      <div className="text-[13px] font-semibold text-ink">{config.title}</div>
      {!applicable ? (
        <div className="text-[11px] text-ink-4">Not applicable</div>
      ) : state.status === "pending" ? (
        <div
          className="mt-1 ml-auto h-3 w-24 animate-pulse rounded bg-card-2"
          aria-label="Solving"
        />
      ) : state.status === "unavailable" ? (
        <div className="text-[11px] text-ink-4">Unavailable</div>
      ) : state.status === "not-achievable" ? (
        <div className="text-[11px] text-[color:var(--color-crit)]">
          Not achievable
        </div>
      ) : (
        <div
          className="whitespace-nowrap text-[11px] tabular text-ink-4"
          title={
            state.summary
              ? `Assets last: ${fmtAgeLast(state.summary)} · ${formatCurrency(state.summary.assetsRemaining)} remaining`
              : undefined
          }
        >
          {fmtAgeLast(state.summary)} ·{" "}
          {state.summary ? fmtCompactCurrency(state.summary.assetsRemaining) : "—"}{" "}
          left
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
  // row to land on. Each column changes exactly ONE lever, so every other cell
  // is unchanged from the row's current value; those are shown dimmed so the
  // single solved value (the green chip) is the thing the eye lands on.
  const isHighlight = applicable && config.highlightRow === row.key;
  const currentDisplay =
    row.currentValue === null ? "—" : fmtRowValue(row, row.currentValue);

  // Unchanged cell (non-highlight, or a non-applicable column): the held value,
  // dimmed.
  if (!isHighlight) {
    return (
      <td className="border-b border-hair px-4 py-2.5 text-right tabular text-[13px] text-ink-4">
        {currentDisplay}
      </td>
    );
  }

  // Highlighted lever cell — its content depends on the solve state.
  if (state.status === "pending") {
    return (
      <td className="border-b border-hair px-4 py-2.5">
        <div
          className="ml-auto h-4 w-16 animate-pulse rounded bg-card-2"
          aria-label="Solving"
        />
      </td>
    );
  }

  if (state.status === "not-achievable" || state.status === "unavailable") {
    return (
      <td className="border-b border-hair px-4 py-2.5 text-right tabular text-[13px] text-ink-4">
        —
      </td>
    );
  }

  // Converged: the solved value as a compact green chip hugging the number,
  // using the column's own formatter (e.g. multiplier → resulting spend).
  const display =
    state.solvedValue === null
      ? "—"
      : (config.formatSolved(state.solvedValue, rows) ?? "—");

  const fundingSource =
    config.id === "min-savings" ? state.fundingSource : null;

  const fundingText =
    fundingSource === null
      ? null
      : (fundingSource.maxExpenseReduction > 0
          ? `Funded from surplus cash flow; reduces living expenses by up to ${formatCurrency(fundingSource.maxExpenseReduction)}/yr`
          : "Funded entirely from surplus cash flow") +
        ` · growing at ${fundingSource.growthLabel}`;

  return (
    <td className="border-b border-hair px-4 py-2.5 text-right">
      <span className="inline-flex items-center justify-end gap-1">
        <span className="inline-block rounded bg-[color:var(--color-good)]/10 px-2 py-0.5 tabular text-[13px] font-semibold text-[color:var(--color-good)]">
          {display}
        </span>
        {fundingText && (
          <TaxDetailTooltip iconLabel="Funding details" text={fundingText} />
        )}
      </span>
    </td>
  );
}

/** Compact in-cell growth-source control for the "Additional Taxable Savings"
 *  lever: the client's taxable default, any firm model portfolio (with its
 *  blended return), or a flat custom rate. Governs both the solved Minimum
 *  Additional Savings column and the Explore recompute for that row. */
function MinSavingsGrowthControl({
  options,
  value,
  onChange,
}: {
  options: ModelPortfolioOption[];
  value: MinSavingsGrowth;
  onChange: (next: MinSavingsGrowth) => void;
}) {
  const selectValue =
    value.kind === "model-portfolio"
      ? value.portfolioId
      : value.kind === "custom-rate"
        ? CUSTOM_VALUE
        : TAXABLE_DEFAULT_VALUE;

  const handleSelect = (next: string) => {
    if (next === TAXABLE_DEFAULT_VALUE) {
      onChange({ kind: "taxable-default" });
    } else if (next === CUSTOM_VALUE) {
      onChange({ kind: "custom-rate", rate: value.kind === "custom-rate" ? value.rate : 0.06 });
    } else {
      onChange({ kind: "model-portfolio", portfolioId: next });
    }
  };

  return (
    <div className="mt-1.5 flex flex-col gap-1">
      <label htmlFor="min-savings-growth" className="text-[11px] text-ink-4">
        Grows in:
      </label>
      <select
        id="min-savings-growth"
        value={selectValue}
        onChange={(e) => handleSelect(e.target.value)}
        className="h-7 w-full max-w-[200px] cursor-pointer rounded-[var(--radius-sm)] border border-hair bg-card-2 px-1.5 text-[12px] text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
      >
        <option value={TAXABLE_DEFAULT_VALUE}>Taxable default (plan setting)</option>
        {options.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} — {(p.blendedReturn * 100).toFixed(1)}%
          </option>
        ))}
        <option value={CUSTOM_VALUE}>Custom rate…</option>
      </select>
      {value.kind === "custom-rate" && (
        <div className="flex items-center gap-1">
          <input
            type="number"
            step="0.1"
            min={0}
            max={20}
            value={(value.rate * 100).toFixed(1)}
            onChange={(e) => {
              const pct = parseFloat(e.target.value);
              if (Number.isNaN(pct)) return;
              onChange({ kind: "custom-rate", rate: pct / 100 });
            }}
            aria-label="Custom growth rate (percent)"
            className="h-7 w-16 rounded-[var(--radius-sm)] border border-hair bg-card-2 px-1.5 text-[12px] text-ink tabular focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
          <span className="text-[11px] text-ink-3">%</span>
        </div>
      )}
    </div>
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
