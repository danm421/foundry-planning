import { FieldTooltip } from "@/components/forms/field-tooltip";
import { CAPACITY_WEIGHTS, type CapacityFactors } from "@/lib/insights/risk-capacity";

/**
 * Help copy states the scoring band for each factor, so an advisor can read a
 * bar and know what would move it. The bands are the curves in
 * `capacityFactors` -- keep the two in step if a curve is ever retuned.
 */
const FACTOR_ORDER: { key: keyof CapacityFactors; label: string; help: string }[] = [
  {
    key: "runway",
    label: "Years to retirement",
    help: "How long until the portfolio has to start paying out. This is the single biggest factor. Time before the first withdrawal is what turns a bad market into something you buy through rather than sell into. Nothing at 0 years, full marks at 20 or more.",
  },
  {
    key: "incomeFloor",
    label: "Guaranteed income",
    help: "The share of retirement spending covered by Social Security and pensions, averaged over the years those benefits are actually paid. Spending that is already covered never has to be funded by selling. Full marks once it covers all spending — a fully covered household scores high here no matter its age.",
  },
  {
    key: "retirementHorizon",
    label: "Length of retirement",
    help: "Years from retirement to the end of the plan. Even once withdrawals begin, money that will not be spent for another two decades still has time to recover. Nothing at 0 years, full marks at 25 or more.",
  },
  {
    key: "withdrawal",
    label: "Withdrawal rate",
    help: "Average yearly spending not covered by income, measured against the portfolio at retirement. Smaller draws leave more room to absorb a loss. Full marks at 0%, nothing at 6% or more.",
  },
  {
    key: "buffer",
    label: "Funding buffer",
    help: "Compares the lowest point the portfolio reaches with its high point. 1.0 means it just touches zero. Nothing at 0.8, full marks at 1.5 — a low point half the height of the peak.",
  },
];

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
      {FACTOR_ORDER.map(({ key, label, help }) => {
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
