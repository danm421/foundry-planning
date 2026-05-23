import type { HeirBox } from "@/lib/estate/estate-flow-summary";

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function EstateFlowSummaryTrustInterests({
  trustInterests,
}: {
  trustInterests: HeirBox["trustInterests"];
}) {
  if (trustInterests.length === 0) return null;
  const total = trustInterests.reduce((s, t) => s + t.amount, 0);
  return (
    <section className="rounded-lg border border-indigo-900/40 bg-indigo-950/15 px-4 py-3">
      <div className="flex items-baseline justify-between gap-3 border-b border-indigo-900/30 pb-1.5">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-indigo-200">
          Trust Interests
        </h3>
        <span className="text-sm font-semibold tabular-nums text-indigo-100">
          {fmt.format(total)}
        </span>
      </div>
      <div className="mt-2 space-y-1">
        {trustInterests.map((t, i) => (
          <div
            key={`${t.trustId}-${i}`}
            className="flex items-baseline justify-between gap-4 py-0.5 text-sm text-gray-300"
          >
            <span className="truncate">{t.trustLabel}</span>
            <span className="tabular-nums text-gray-200">
              {fmt.format(t.amount)}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
