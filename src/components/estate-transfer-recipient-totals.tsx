import type { RecipientTotal } from "@/lib/estate/transfer-report";
import type { LineDiff } from "@/lib/estate/diff-estate-tax";
import { EstateDeltaChip, EstateRowMarker } from "./estate-delta-chip";

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function EstateTransferRecipientTotals({
  totals,
  diff = null,
}: {
  totals: RecipientTotal[];
  /** Compare mode: each recipient's change against the other column, keyed by
   *  `RecipientTotal.key`. Absent outside compare mode. */
  diff?: Map<string, LineDiff> | null;
}) {
  if (totals.length === 0) return null;
  return (
    <section className="overflow-hidden rounded-xl border border-indigo-900/50 bg-indigo-950/15">
      <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-indigo-900/40 px-5 py-3">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-indigo-300/80">
            Where it ends up
          </span>
          <h2 className="text-base font-semibold text-ink">Recipient totals</h2>
        </div>
      </header>
      <div className="px-5 py-3">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-[0.16em] text-indigo-300/70">
              <th className="py-1 text-left font-medium">Recipient</th>
              <th className="py-1 text-right font-medium">From 1st Death</th>
              <th className="py-1 text-right font-medium">From 2nd Death</th>
              <th className="py-1 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-indigo-900/20">
            {totals.map((t) => {
              const line = diff?.get(t.key);
              return (
                <tr key={t.key} className="hover:[&>td]:shadow-[inset_0_1px_0_var(--color-ink),inset_0_-1px_0_var(--color-ink)]">
                  <td className="py-1 text-ink-2">
                    {t.recipientLabel}
                    {/* `empty:hidden` drops the gap on rows the marker renders nothing for. */}
                    {line && (
                      <span className="ml-2 empty:hidden">
                        <EstateRowMarker status={line.status} />
                      </span>
                    )}
                  </td>
                  <td className="py-1 text-right tabular-nums text-ink-2">
                    {fmt.format(t.fromFirstDeath)}
                  </td>
                  <td className="py-1 text-right tabular-nums text-ink-2">
                    {fmt.format(t.fromSecondDeath)}
                  </td>
                  <td className="py-1 text-right tabular-nums font-semibold text-ink">
                    <span className="flex items-baseline justify-end gap-2">
                      {line && (
                        // More money reaching an heir is the GOOD news here —
                        // the opposite of every chip on the two tax reports.
                        <EstateDeltaChip delta={line.delta} goodDirection="up" />
                      )}
                      <span>{fmt.format(t.total)}</span>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
