"use client";

// Loading + empty states for the life-insurance need-over-time chart.
//
// `ShieldLoader` is the "solving" loader shown before the solve's plan-year
// range lands: the same shield-check the empty state uses, drawing itself in
// stroke by stroke over a soft verdigris halo that breathes while the solve
// resolves — a calm, branded mark rather than a busy spinner. `NoNeedState`
// is the settled display when no plan year ever carries a need. Both share the
// one shield motif; all motion sits behind `prefers-reduced-motion`, handled
// by the `.li-shield-*` utilities in globals.css (reduced motion shows a
// static, fully-drawn mark).

// The shield-check mark, shared by the loader and the empty state so both read
// as the same object. Outline first, checkmark second. When `animated`, each
// path carries the `.li-shield-*` draw-in class; `pathLength={100}` normalises
// the path so the animation can offset a flat 100 units regardless of the
// path's real geometry. The empty state renders it static (no class).
function ShieldCheckPaths({ animated = false }: { animated?: boolean }) {
  return (
    <>
      <path
        className={animated ? "li-shield-outline" : undefined}
        pathLength={100}
        d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"
      />
      <path
        className={animated ? "li-shield-check" : undefined}
        pathLength={100}
        d="m9 12 2 2 4-4"
      />
    </>
  );
}

/**
 * "Solving" loader — an animated verdigris shield mark shown while the
 * need-by-year solve's plan-year range is still resolving. The shield outline
 * draws in, the check strokes on, and a soft verdigris halo breathes behind
 * it. Under `prefers-reduced-motion` the `.li-shield-*` utilities collapse to
 * a static, fully-drawn mark (no draw-in, no breathing).
 */
export function ShieldLoader() {
  return (
    <div className="flex h-full min-h-[180px] flex-col items-center justify-center rounded-md border border-hair bg-card-2 px-6 text-center">
      <div className="relative flex h-16 w-16 items-center justify-center">
        {/* Soft verdigris halo, breathing behind the mark. */}
        <span
          aria-hidden
          className="li-shield-halo pointer-events-none absolute inset-0 rounded-full"
          style={{
            background:
              "radial-gradient(circle at center, color-mix(in srgb, var(--color-accent) 55%, transparent) 0%, color-mix(in srgb, var(--color-accent) 16%, transparent) 46%, transparent 72%)",
          }}
        />
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="relative h-10 w-10 text-accent"
          aria-hidden
        >
          <ShieldCheckPaths animated />
        </svg>
      </div>
      <p aria-hidden className="mt-4 text-[13px] text-ink-3">
        Solving the life-insurance need, year by year…
      </p>
      <span className="sr-only">
        Solving the life-insurance need, year by year. This can take a moment.
      </span>
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
          <ShieldCheckPaths />
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
