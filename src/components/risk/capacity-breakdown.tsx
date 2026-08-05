import { FieldTooltip } from "@/components/forms/field-tooltip";
import { CAPACITY_WEIGHTS, type CapacityFactors } from "@/lib/insights/risk-capacity";
import { CAPACITY_FACTOR_ORDER } from "@/lib/risk/labels";

/**
 * Five bars, one per `computeCapacityScore` contribution. Each factor is
 * already a WEIGHTED contribution (runway tops out at 0.50, not 1), so a
 * bar's fill is the contribution against its own weight ceiling from
 * `CAPACITY_WEIGHTS` -- a fully-maxed factor always reads as a full bar
 * regardless of which weight it carries. The ceilings are deliberately
 * lopsided, and ordered heaviest-first: runway and the income floor are the
 * two routes to real capacity, and the other three are supporting evidence.
 *
 * The five ceilings sum to 143, NOT to the capacity score: the blend is capped
 * at `CAPACITY_SCORE_MAX`. So these numbers sum to `capacityScore / 100` only
 * below the cap, and a maxed-out household's bars will visibly total more than
 * its score. That gap is the headroom, and it is explained on the score itself
 * in `risk-detail-content` rather than repeated on every bar.
 */
export function CapacityBreakdown({ factors }: { factors: CapacityFactors }) {
  return (
    <div className="space-y-2.5">
      {CAPACITY_FACTOR_ORDER.map(({ key, label, help }) => {
        const ceiling = CAPACITY_WEIGHTS[key];
        const value = factors[key];
        const fillPct = ceiling > 0 ? Math.min(100, Math.max(0, (value / ceiling) * 100)) : 0;
        return (
          <div key={key}>
            <div className="flex items-baseline justify-between text-xs text-ink-2">
              <span className="flex items-center gap-1.5">
                {label}
                <FieldTooltip text={help} />
              </span>
              <span className="tabular text-ink-3">
                {Math.round(value * 100)} / {Math.round(ceiling * 100)}
              </span>
            </div>
            <span className="mt-1 block h-1.5 rounded-full bg-card-2">
              <span
                className="block h-1.5 rounded-full bg-accent"
                style={{ width: `${fillPct}%` }}
              />
            </span>
          </div>
        );
      })}
    </div>
  );
}
