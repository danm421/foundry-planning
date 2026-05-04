import type { RecipientTotal } from "@/lib/estate/transfer-report";

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function EstateTransferRecipientTotals({
  totals,
}: {
  totals: RecipientTotal[];
}) {
  if (totals.length === 0) return null;
  return (
    <section className="overflow-hidden rounded-xl border border-indigo-900/50 bg-indigo-950/15">
      <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-indigo-900/40 px-5 py-3">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-indigo-300/80">
            Where it ends up
          </span>
          <h2 className="text-base font-semibold text-gray-50">Recipient totals</h2>
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
            {totals.map((t) => (
              <tr key={t.key}>
                <td className="py-1 text-gray-200">{t.recipientLabel}</td>
                <td className="py-1 text-right font-mono tabular-nums text-gray-300">
                  {fmt.format(t.fromFirstDeath)}
                </td>
                <td className="py-1 text-right font-mono tabular-nums text-gray-300">
                  {fmt.format(t.fromSecondDeath)}
                </td>
                <td className="py-1 text-right font-mono tabular-nums font-semibold text-gray-50">
                  {fmt.format(t.total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
