import type { ReductionsLine } from "@/lib/estate/transfer-report";

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function EstateTransferReductionsCard({
  reductions,
  taxableEstate,
}: {
  reductions: ReductionsLine[];
  /** Form 706 taxable estate — gross estate net of marital, charitable,
   *  and admin-expense deductions. Anchors the tax track. Optional — pass
   *  when displaying the tax context. */
  taxableEstate?: number;
}) {
  if (reductions.length === 0 && taxableEstate == null) {
    return null;
  }
  const total = reductions.reduce((s, r) => s + r.amount, 0);
  return (
    <section className="rounded-lg border border-rose-900/40 bg-rose-950/15 px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="flex items-baseline gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-rose-200">
          <span>Reductions</span>
          <span className="font-normal normal-case tracking-normal text-[11px] text-rose-200/70">
            drained from heirs before they receive their share
          </span>
        </h3>
        <span className="font-mono text-sm font-semibold tabular-nums text-rose-200">
          {fmt.format(total)}
        </span>
      </div>
      <div className="mt-1.5 divide-y divide-rose-900/30">
        {taxableEstate != null && (
          <div
            className="flex items-baseline justify-between gap-4 py-1 text-sm text-rose-100/90"
            title="Form 706 taxable estate — gross estate minus marital, charitable, and admin-expense deductions. This is the amount actually subject to federal estate tax."
          >
            <span>Taxable estate (Form 706)</span>
            <span className="font-mono tabular-nums">{fmt.format(taxableEstate)}</span>
          </div>
        )}
        {reductions.map((r) => (
          <div
            key={r.kind}
            className="flex items-baseline justify-between gap-4 py-1 text-sm text-rose-100/90"
          >
            <span>{r.label}</span>
            <span className="font-mono tabular-nums">{fmt.format(r.amount)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
