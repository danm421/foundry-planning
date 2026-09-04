"use client";

import type { RiskAlignment } from "@/lib/insights/risk-capacity";

const VERDICT_LABEL: Record<RiskAlignment["verdict"], string> = {
  aligned: "Aligned",
  over_risked: "Over-risked",
  under_risked: "Under-risked",
  goals_over_reaching: "Goals need review",
};

/** aligned = positive, over/under-risked = warning, goals_over_reaching = danger. */
const VERDICT_BADGE_CLASS: Record<RiskAlignment["verdict"], string> = {
  aligned: "border-good/40 bg-good/10 text-good",
  over_risked: "border-warn/40 bg-warn/10 text-warn",
  under_risked: "border-warn/40 bg-warn/10 text-warn",
  goals_over_reaching: "border-crit/40 bg-crit/10 text-crit",
};

/** Growth-exposure points within which two markers are treated as colliding. */
const OVERLAP_THRESHOLD_PCT = 4;
/** Vertical stagger per collision row, in px. */
const ROW_OFFSET_PX = 22;

/** Within this many percent of either end, a centred label would overflow the
 *  panel, so the marker's text is shunted inward. */
const EDGE_PCT = 8;
/** Room for one unstaggered marker's label + value + a short connector. */
const BASE_AREA_PX = 44;

interface MarkerSpec {
  key: "required" | "capacity" | "current" | "tolerance";
  pct: number;
  label: string;
  textClass: string;
  tickClass: string;
}

/**
 * Greedy row assignment: markers within OVERLAP_THRESHOLD_PCT of one another
 * stack onto separate rows instead of rendering on top of each other. Since
 * input is sorted ascending, checking distance to only the last marker
 * placed in a row is sufficient to guarantee separation across the row.
 */
function assignRows(markers: MarkerSpec[]): Record<string, number> {
  const sorted = [...markers].sort((a, b) => a.pct - b.pct);
  const lastPctByRow: number[] = [];
  const rowByKey: Record<string, number> = {};
  for (const m of sorted) {
    let row = lastPctByRow.findIndex((lastPct) => m.pct - lastPct >= OVERLAP_THRESHOLD_PCT);
    if (row === -1) {
      row = lastPctByRow.length;
      lastPctByRow.push(m.pct);
    } else {
      lastPctByRow[row] = m.pct;
    }
    rowByKey[m.key] = row;
  }
  return rowByKey;
}

function Marker({
  pct,
  label,
  textClass,
  tickClass,
  row,
  maxRow,
}: {
  pct: number;
  label: string;
  textClass: string;
  tickClass: string;
  row: number;
  maxRow: number;
}) {
  const clamped = Math.min(100, Math.max(0, pct));
  // Anchoring both `top` and `bottom` (no explicit height) makes the box
  // auto-stretch from its staggered top down to the track — the connector
  // (a flex-1 filler) always reaches the track regardless of stagger row.
  const topPx = (maxRow - row) * ROW_OFFSET_PX;
  // The column is centred on the tick, so a marker at either extreme would hang
  // half its label outside the panel — and 0% is the ordinary state for a
  // household with no risk profile on file. Near an edge, shunt the TEXT back
  // inside (start-aligned at 0%, end-aligned at 100%) while the tick itself
  // stays exactly on the value.
  const labelShift =
    clamped <= EDGE_PCT ? "translate-x-1/2" : clamped >= 100 - EDGE_PCT ? "-translate-x-1/2" : "";
  return (
    <div
      className="absolute flex -translate-x-1/2 flex-col items-center"
      style={{ left: `${clamped}%`, top: `${topPx}px`, bottom: 0 }}
    >
      <span className={`flex flex-col items-center ${labelShift}`}>
        <span className={`text-[11px] font-medium leading-tight ${textClass}`}>{label}</span>
        <span className={`tabular text-[11px] leading-tight ${textClass}`}>
          {Math.round(pct)}%
        </span>
      </span>
      <span className={`mt-1 w-px flex-1 ${tickClass}`} aria-hidden />
    </div>
  );
}

export function RiskAlignmentScale({
  risk,
  tolerancePct = null,
}: {
  risk: RiskAlignment;
  /** Recorded tolerance rung, or null when no risk profile is on file. */
  tolerancePct?: number | null;
}) {
  const markers: MarkerSpec[] = [
    {
      key: "required",
      pct: risk.requiredPct,
      label: "Required",
      textClass: "text-data-blue",
      tickClass: "bg-data-blue",
    },
    {
      key: "capacity",
      pct: risk.capacityPct,
      label: "Capacity",
      textClass: "text-data-teal",
      tickClass: "bg-data-teal",
    },
    {
      key: "current",
      pct: risk.currentPct,
      label: "Current",
      textClass: "text-data-yellow",
      tickClass: "bg-data-yellow",
    },
  ];
  // Only when a rung is actually recorded. A household with no RTQ must show
  // three markers, not a fourth pinned at zero — which would read as "this
  // client will accept no risk at all".
  if (tolerancePct != null) {
    markers.push({
      key: "tolerance",
      pct: tolerancePct,
      label: "Tolerance",
      textClass: "text-data-purple",
      tickClass: "bg-data-purple",
    });
  }
  const rowByKey = assignRows(markers);
  const maxRow = Math.max(...Object.values(rowByKey));
  const areaHeight = BASE_AREA_PX + maxRow * ROW_OFFSET_PX;

  return (
    <section className="rounded-[var(--radius)] border border-hair-2 bg-card p-5">
      <div className="mb-6 flex items-center justify-between gap-3">
        <h3 className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-2">
          Risk capacity &amp; alignment
        </h3>
        <span
          className={`rounded-[var(--radius-sm)] border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] ${VERDICT_BADGE_CLASS[risk.verdict]}`}
        >
          {VERDICT_LABEL[risk.verdict]}
        </span>
      </div>

      <div className="relative" style={{ height: `${areaHeight}px` }}>
        {markers.map((m) => (
          <Marker
            key={m.key}
            pct={m.pct}
            label={m.label}
            textClass={m.textClass}
            tickClass={m.tickClass}
            row={rowByKey[m.key]}
            maxRow={maxRow}
          />
        ))}
        <div className="absolute inset-x-0 bottom-0 h-[3px] bg-hair-2" />
      </div>

      <div className="mt-2 flex justify-between font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-3">
        <span>Conservative</span>
        <span>Aggressive</span>
      </div>
    </section>
  );
}
