"use client";

// Loading + empty states for the life-insurance need-over-time chart.
//
// `DevelopingSkeleton` is the "developing" loader shown before the solve's
// year range lands: ghost bars at plausible heights with a verdigris shimmer
// sweep and a gentle per-bar breathe, so the panel reads as the chart
// resolving into focus. `NoNeedState` is the clean display when no plan year
// ever carries a need. All motion sits behind `prefers-reduced-motion`,
// handled by the `.li-*` utilities in globals.css.

// Ghost-bar heights (percent of the plot), eyeballed for an organic profile —
// a couple of gentle humps rather than a monotonic ramp. Fixed so the skeleton
// never flickers between re-renders.
const GHOST_HEIGHTS = [
  38, 52, 64, 48, 30, 42, 58, 72, 80, 66, 50, 60, 74, 68, 46, 34, 44, 56,
];

/**
 * "Developing" loading skeleton — ghost bars under a verdigris shimmer sweep.
 * Married plans hint the client/spouse split with a two-tone bar.
 */
export function DevelopingSkeleton({ isMarried }: { isMarried: boolean }) {
  return (
    <div className="relative h-full min-h-[180px] w-full overflow-hidden rounded-md">
      <div className="flex h-full items-end gap-[3px] border-b border-hair px-1 pb-px">
        {GHOST_HEIGHTS.map((h, i) => (
          <div
            key={i}
            className="li-bar-breathe flex min-w-0 flex-1 flex-col justify-end"
            style={{ height: `${h}%`, animationDelay: `${i * 70}ms` }}
          >
            {isMarried ? (
              <div className="w-full rounded-t-[2px] bg-hair" style={{ height: "38%" }} />
            ) : null}
            <div
              className={`w-full bg-hair-2 ${isMarried ? "" : "rounded-t-[2px]"}`}
              style={{ height: isMarried ? "62%" : "100%" }}
            />
          </div>
        ))}
      </div>
      {/* Verdigris sheen gliding across the ghost bars. */}
      <div aria-hidden className="li-shimmer-sweep pointer-events-none absolute inset-0" />
      <span className="sr-only">Preparing the life-insurance need-by-year solve…</span>
    </div>
  );
}

/**
 * Clean "no need" display — shown when no plan year carries a life-insurance
 * need in any death scenario, so the chart would otherwise be empty.
 */
export function NoNeedState({
  isMarried,
  clientName,
  spouseName,
}: {
  isMarried: boolean;
  clientName: string;
  spouseName: string;
}) {
  const who = isMarried ? `${clientName} or ${spouseName}` : clientName;
  return (
    <div className="flex h-full min-h-[180px] flex-col items-center justify-center rounded-md border border-hair bg-card-2 px-6 text-center">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-accent-wash">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-5 w-5 text-accent"
          aria-hidden
        >
          <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      </div>
      <p className="text-[15px] font-semibold text-ink">
        No additional life insurance needed
      </p>
      <p className="mt-1.5 max-w-sm text-[13px] text-ink-3">
        In every year of this plan, projected assets already cover the need — no
        additional coverage is required for {who}.
      </p>
    </div>
  );
}
