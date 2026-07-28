import { CAPACITY_WEIGHTS, type CapacityFactors } from "@/lib/insights/risk-capacity";

const FACTOR_ORDER: { key: keyof CapacityFactors; label: string }[] = [
  { key: "horizon", label: "Time horizon" },
  { key: "buffer", label: "Funding buffer" },
  { key: "withdrawal", label: "Withdrawal rate" },
  { key: "incomeFloor", label: "Guaranteed income" },
];

/**
 * Four bars, one per `computeCapacityScore` contribution. Each factor is
 * already a WEIGHTED contribution (horizon tops out at 0.3, not 1), so a
 * bar's fill is the contribution against its own weight ceiling from
 * `CAPACITY_WEIGHTS` -- a fully-maxed factor always reads as a full bar
 * regardless of which weight it carries. Read together, the four numbers
 * sum to `capacityScore / 100`.
 */
export function CapacityBreakdown({ factors }: { factors: CapacityFactors }) {
  return (
    <div className="space-y-2.5">
      {FACTOR_ORDER.map(({ key, label }) => {
        const ceiling = CAPACITY_WEIGHTS[key];
        const value = factors[key];
        const fillPct = ceiling > 0 ? Math.min(100, Math.max(0, (value / ceiling) * 100)) : 0;
        return (
          <div key={key}>
            <div className="flex items-baseline justify-between text-xs text-ink-2">
              <span>{label}</span>
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
