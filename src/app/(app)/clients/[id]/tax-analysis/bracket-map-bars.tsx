import type { BracketMap } from "@/lib/tax-analysis/bracket-map";
import { computeBracketBarLayout } from "@/lib/tax-analysis/bracket-map";
import { fmtUsd, fmtPct } from "@/lib/tax-analysis/format";

/** Horizontal stacked bar per bracket; fill = portion of the ordinary tax base
 *  inside each bracket. Second bar shows cap-gains stacking over the 0/15/20
 *  breakpoints. Geometry (visible-segment filter, scaleTop taxBase=0 guard,
 *  cap-gains cgTop/cgPct) lives in computeBracketBarLayout, shared with the
 *  PDF renderer's identical bars (tax-analysis-pdf-document.tsx). */
export function BracketMapBars({ map }: { map: BracketMap }) {
  const layout = computeBracketBarLayout(map);

  return (
    <div data-testid="bracket-map" className="flex flex-col gap-5">
      <div>
        <div className="mb-1 flex items-baseline justify-between">
          <span className="text-sm font-medium">Ordinary income brackets</span>
          <span className="text-xs text-ink-3">
            {fmtUsd(map.ordinary.taxBase)} of ordinary taxable income
          </span>
        </div>
        <div className="flex h-8 w-full overflow-hidden rounded border border-hair">
          {layout.segments.map((seg) => (
            <div key={seg.from} className="relative border-r border-hair last:border-r-0" style={{ width: `${seg.widthPct}%` }}>
              <div className="absolute inset-y-0 left-0 bg-accent/70" style={{ width: `${seg.fillPct}%` }} />
              <span className="absolute inset-0 flex items-center justify-center text-[10px] text-ink-2">
                {fmtPct(seg.rate)}
              </span>
            </div>
          ))}
        </div>
        {map.ordinary.headroomToNext != null && map.ordinary.nextRate != null && (
          <p className="mt-1 text-xs text-ink-3">
            {fmtUsd(map.ordinary.headroomToNext)} of headroom remains at {fmtPct(map.ordinary.marginalRate)} before the {fmtPct(map.ordinary.nextRate)} bracket.
          </p>
        )}
      </div>

      <div>
        <div className="mb-1 flex items-baseline justify-between">
          <span className="text-sm font-medium">Long-term gains &amp; qualified dividends</span>
          <span className="text-xs text-ink-3">{fmtUsd(map.capGains.preferentialBase)} stacked on top of ordinary income</span>
        </div>
        <div className="relative h-8 w-full overflow-hidden rounded border border-hair">
          <div className="absolute inset-y-0 left-0 bg-ink-3/20" style={{ width: `${layout.capGains.floorPct}%` }} />
          <div
            className="absolute inset-y-0 bg-accent/70"
            style={{ left: `${layout.capGains.fillLeftPct}%`, width: `${layout.capGains.fillWidthPct}%` }}
          />
          <div className="absolute inset-y-0 border-l-2 border-dashed border-ink-2" style={{ left: `${layout.capGains.markerLeftPct}%` }} />
        </div>
        <p className="mt-1 text-xs text-ink-3">
          Dashed line = top of the 0% bracket ({fmtUsd(map.capGains.zeroPctTop)}).{" "}
          {map.capGains.zeroPctHeadroom > 0
            ? `${fmtUsd(map.capGains.zeroPctHeadroom)} of gains could still be realized at 0%.`
            : "This return's income is above the 0% capital-gains bracket."}
        </p>
      </div>
    </div>
  );
}
