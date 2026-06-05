"use client";

import { summarizeGrant } from "./grant-state";

/** Decimal fields from the API come back as strings; this is the parsed-for-display shape. */
export interface GrantDisplay {
  id: string;
  grantNumber: string | null;
  grantType: "rsu" | "nqso" | "iso";
  grantDate: string;
  sharesGranted: number;
  has83bElection: boolean;
  fmvAtGrant: number | null;
  strikePrice: number | null;
  strikeDiscountPct: number | null;
  expirationDate: string | null;
  notes: string | null;
  tranches: Array<{
    vestDate: string;
    shares: number;
    sharesExercised: number;
    sharesSold: number;
  }>;
}

interface GrantCardProps {
  grant: GrantDisplay;
  currentYear?: number;
  onEdit: () => void;
  onDelete: () => void;
}

const GRANT_TYPE_LABELS: Record<"rsu" | "nqso" | "iso", string> = {
  rsu: "RSU",
  nqso: "NQSO",
  iso: "ISO",
};

// Color palette for the segmented status bar segments
const BAR_COLORS = {
  unvested: "bg-gray-600",
  vestedHeld: "bg-blue-500",
  exercisedHeld: "bg-accent",
  sold: "bg-green-600",
};

function fmt(n: number): string {
  // Drop fractional zeros for display
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export default function GrantCard({ grant, currentYear, onEdit, onDelete }: GrantCardProps) {
  const year = currentYear ?? new Date().getFullYear();

  // Convert tranches: vestDate YYYY-MM-DD → vestYear
  const tranchesForSummary = grant.tranches.map((t) => ({
    vestYear: parseInt(t.vestDate.slice(0, 4), 10),
    shares: t.shares,
    sharesExercised: t.sharesExercised,
    sharesSold: t.sharesSold,
  }));

  const summary = summarizeGrant({
    grantType: grant.grantType,
    currentYear: year,
    tranches: tranchesForSummary,
  });

  const { granted, unvested, vestedHeld, exercisedHeld, sold } = summary;
  const held = vestedHeld + exercisedHeld;

  // Compute bar widths as percentages (guard divide-by-zero)
  function barWidth(bucket: number): string {
    if (granted === 0) return "0%";
    return `${Math.max(0, (bucket / granted) * 100)}%`;
  }

  const displayName = grant.grantNumber ? `Grant ${grant.grantNumber}` : "Grant";

  return (
    <div className="rounded-md border border-gray-700 bg-card p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-gray-200">{displayName}</span>
          <span className="rounded px-1.5 py-0.5 text-xs font-medium bg-gray-700 text-gray-200">
            {GRANT_TYPE_LABELS[grant.grantType]}
          </span>
          {grant.has83bElection && (
            <span className="rounded px-1.5 py-0.5 text-xs font-medium bg-amber-900/60 text-amber-300 border border-amber-700/50">
              83(b)
            </span>
          )}
          <span className="text-xs text-gray-400">{grant.grantDate}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onEdit}
            className="text-xs text-accent hover:text-accent-ink"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="text-xs text-gray-400 hover:text-red-400"
          >
            Remove
          </button>
        </div>
      </div>

      {/* Segmented status bar */}
      {granted > 0 ? (
        <div
          className="flex h-3 w-full overflow-hidden rounded-full bg-gray-800"
          title={`${fmt(unvested)} unvested · ${fmt(vestedHeld)} vested held · ${fmt(exercisedHeld)} exercised held · ${fmt(sold)} sold`}
          role="img"
          aria-label="Grant share status"
        >
          <div className={`${BAR_COLORS.unvested} h-full`} style={{ width: barWidth(unvested) }} />
          <div className={`${BAR_COLORS.vestedHeld} h-full`} style={{ width: barWidth(vestedHeld) }} />
          <div className={`${BAR_COLORS.exercisedHeld} h-full`} style={{ width: barWidth(exercisedHeld) }} />
          <div className={`${BAR_COLORS.sold} h-full`} style={{ width: barWidth(sold) }} />
        </div>
      ) : (
        <div className="h-3 w-full rounded-full bg-gray-800" />
      )}

      {/* Chips row */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-400">
        <span>
          <span className="text-gray-200">{fmt(granted)}</span> granted
        </span>
        <span className="text-gray-600">·</span>
        <span>
          <span className="text-gray-200">{fmt(unvested)}</span> unvested
        </span>
        <span className="text-gray-600">·</span>
        <span>
          <span className="text-gray-200">{fmt(held)}</span> held
        </span>
        <span className="text-gray-600">·</span>
        <span>
          <span className="text-gray-200">{fmt(sold)}</span> sold
        </span>
      </div>

      {/* Task 19: vesting grid + grant-level strategy override controls render here */}
    </div>
  );
}
