import type { ReductionsLine } from "@/lib/estate/transfer-report";

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function EstateTransferReductionsCard({
  reductions,
}: {
  reductions: ReductionsLine[];
}) {
  if (reductions.length === 0) {
    return null;
  }
  const total = reductions.reduce((s, r) => s + r.amount, 0);
  return (
    <section className="rounded-lg border border-rose-900/40 bg-rose-950/15 px-5 py-4 ring-1 ring-rose-900/20">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-rose-200">
          Reductions
        </h3>
        <span className="font-mono text-sm font-semibold tabular-nums text-rose-200">
          {fmt.format(total)}
        </span>
      </div>
      <p className="mb-3 text-[11px] text-rose-200/70">
        Amounts that come off the gross estate before heirs receive their share.
      </p>
      <div className="divide-y divide-rose-900/30">
        {reductions.map((r) => (
          <div
            key={r.kind}
            className="flex items-baseline justify-between gap-4 py-1.5 text-sm text-rose-100/90"
          >
            <span>{r.label}</span>
            <span className="font-mono tabular-nums">{fmt.format(r.amount)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
