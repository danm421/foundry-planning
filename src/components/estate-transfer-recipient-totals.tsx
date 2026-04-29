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
    <section className="overflow-hidden rounded-2xl border border-indigo-900/50 bg-gradient-to-br from-indigo-950/40 via-gray-900 to-gray-950 shadow-2xl shadow-black/30 ring-1 ring-indigo-500/10">
      <header className="border-b border-indigo-900/40 px-6 py-4">
        <div className="text-[10px] font-medium uppercase tracking-[0.24em] text-indigo-300/80">
          Where it ends up
        </div>
        <h2 className="mt-1 text-lg font-semibold text-gray-50">Recipient totals</h2>
      </header>
      <div className="px-6 py-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-[0.18em] text-indigo-300/70">
              <th className="py-1.5 text-left font-medium">Recipient</th>
              <th className="py-1.5 text-right font-medium">From 1st Death</th>
              <th className="py-1.5 text-right font-medium">From 2nd Death</th>
              <th className="py-1.5 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-indigo-900/20">
            {totals.map((t) => (
              <tr key={t.key}>
                <td className="py-1.5 text-gray-200">{t.recipientLabel}</td>
                <td className="py-1.5 text-right font-mono tabular-nums text-gray-300">
                  {fmt.format(t.fromFirstDeath)}
                </td>
                <td className="py-1.5 text-right font-mono tabular-nums text-gray-300">
                  {fmt.format(t.fromSecondDeath)}
                </td>
                <td className="py-1.5 text-right font-mono tabular-nums font-semibold text-gray-50">
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
