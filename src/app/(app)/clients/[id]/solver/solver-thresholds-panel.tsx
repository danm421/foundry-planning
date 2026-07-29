"use client";

import { useMemo, useState } from "react";
import type { ClientData, ProjectionYear } from "@/engine/types";
import { buildThresholdReport } from "@/lib/reports/threshold-report-data";
import { resolveThresholdParams } from "@/lib/solver/threshold-params";
import type { ThresholdItemId, ThresholdStatus } from "@/lib/tax/thresholds";

interface Props {
  /** Live scenario ("Alternative") projection years. */
  years: ProjectionYear[];
  /** Base plan ("Original") projection years. */
  baseProjection: ProjectionYear[];
  /** The Alternative's effective tree — resolves the shared TaxYearParameters
   *  (see threshold-params.ts; R4/R7). */
  workingTree: ClientData;
}

// Generic labels. Correct for the ten BENEFIT rows, where "out" means the
// benefit has phased away. Wrong for a BURDEN row — a point threshold whose
// "out" means a tax/limit now bites, not that something desirable is gone.
const STATUS_LABEL: Record<ThresholdStatus, string> = {
  full: "Full",
  partial: "Partial",
  out: "Phased Out",
  na: "N/A",
};

// Per-item overrides for burden-type items where the generic labels above
// read backwards. `niit` is a point threshold (rangeFor(...).end == null):
// "out" (income >= the threshold) means the 3.8% surtax applies; "full"
// means it doesn't. "Phased Out" / "Full" would tell an advisor the exact
// opposite of what's true.
//
// EVERY genuine point-threshold item — excluding charitableLimit, which
// statusFor() always resolves to "full" and so never reaches this map — MUST
// have an entry here. That invariant is pinned by a guard test in
// solver-thresholds-panel.test.ts: it walks THRESHOLD_ITEMS, calls
// rangeFor() for each, and fails the day a new point-threshold item (a range
// whose `end` is null) ships without a deliberate label decision here.
const ITEM_STATUS_LABEL_OVERRIDES: Partial<
  Record<ThresholdItemId, Partial<Record<ThresholdStatus, string>>>
> = {
  niit: { full: "Does Not Apply", out: "Applies" },
};

/** Resolve the display label for one status cell, honoring any per-item
 *  override (see `ITEM_STATUS_LABEL_OVERRIDES` above). Exported so the guard
 *  test can assert every point-threshold item has a deliberate override. */
export function resolveStatusLabel(id: ThresholdItemId, status: ThresholdStatus): string {
  return ITEM_STATUS_LABEL_OVERRIDES[id]?.[status] ?? STATUS_LABEL[status];
}

const STATUS_CLASS: Record<ThresholdStatus, string> = {
  full: "text-good",
  partial: "text-warn",
  out: "text-crit",
  na: "text-ink-4",
};

function StatusCell({ id, status }: { id: ThresholdItemId; status: ThresholdStatus }) {
  return (
    <span className={`text-[12px] font-medium ${STATUS_CLASS[status]}`}>
      {resolveStatusLabel(id, status)}
    </span>
  );
}

/** A per-side dollar ceiling standing in for a status cell — `charitableLimit`
 *  only (see `ThresholdReportRow.alternativeThresholdDisplay`). It sits in a
 *  status column, so it keeps those cells' 12px rhythm rather than the Range
 *  cell's, and is `tabular` so the two sides' figures align digit-for-digit. */
function CeilingCell({ display }: { display: string }) {
  return <span className="tabular text-[12px] text-ink-2">{display}</span>;
}

export function SolverThresholdsPanel({ years, baseProjection, workingTree }: Props) {
  // Defaults to the first projection year; falls back to it again if the
  // previously-selected year drops out of a shrunk `years` array.
  const [requestedYear, setRequestedYear] = useState<number | null>(null);
  const year = useMemo(() => {
    if (requestedYear != null && years.some((y) => y.year === requestedYear)) {
      return requestedYear;
    }
    return years[0]?.year ?? null;
  }, [requestedYear, years]);

  const scenario = useMemo(
    () => years.find((y) => y.year === year),
    [years, year],
  );
  const base = useMemo(
    () => baseProjection.find((y) => y.year === year),
    [baseProjection, year],
  );
  const params = useMemo(
    () => (year == null ? null : resolveThresholdParams(workingTree, year)),
    [workingTree, year],
  );

  // Bracket tax mode only — thresholdFacts is never populated in flat mode
  // (see threshold-report-data.ts's header comment). No household, no
  // params ⇒ nothing meaningful to build; never synthesize a household to
  // fill the gap (R6).
  const rows = useMemo(() => {
    if (year == null || scenario?.thresholdFacts == null || params == null) return null;
    return buildThresholdReport({
      year,
      scenario,
      base,
      params,
      household: scenario.thresholdFacts.household,
    });
  }, [year, scenario, base, params]);

  if (years.length === 0) {
    return <div className="p-6 text-sm text-ink-3">No projection years to show.</div>;
  }

  return (
    <div className="space-y-3 p-1">
      <div className="flex items-center gap-2">
        <label htmlFor="thresholds-year" className="text-[12px] text-ink-3">
          Year
        </label>
        <select
          id="thresholds-year"
          value={year ?? ""}
          onChange={(e) => setRequestedYear(Number(e.target.value))}
          className="tabular h-8 rounded-md border border-hair-2 bg-card-2 px-2 text-[13px] text-ink focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
        >
          {years.map((y) => (
            <option key={y.year} value={y.year}>
              {y.year}
            </option>
          ))}
        </select>
      </div>

      {rows == null ? (
        <div className="rounded-md border border-hair-2 bg-card-2 px-4 py-5 text-sm text-ink-2">
          The Thresholds report requires bracket tax mode. Switch the plan&apos;s
          tax engine to Bracket to see phase-out status for this year.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-ink-3">
                <th className="px-3 py-2 text-left font-normal">
                  <span className="border-b border-dotted border-hair pb-px">Threshold</span>
                </th>
                <th className="px-3 py-2 text-right font-normal">
                  <span className="border-b border-dotted border-hair pb-px">Range</span>
                </th>
                <th className="border-l border-hair px-3 py-2 text-right font-normal">
                  <span className="border-b border-dotted border-hair pb-px">Alternative</span>
                </th>
                <th className="px-3 py-2 text-right font-normal">
                  <span className="border-b border-dotted border-hair pb-px">Original</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-hair">
                  <td className="px-3 py-2 text-ink">{r.label}</td>
                  <td className="tabular px-3 py-2 text-right text-ink-2">{r.thresholdDisplay}</td>
                  <td className="border-l border-hair px-3 py-2 text-right">
                    {r.alternativeThresholdDisplay != null
                      ? <CeilingCell display={r.alternativeThresholdDisplay} />
                      : <StatusCell id={r.id} status={r.alternativeStatus} />}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {r.originalThresholdDisplay != null
                      ? <CeilingCell display={r.originalThresholdDisplay} />
                      : <StatusCell id={r.id} status={r.originalStatus} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
