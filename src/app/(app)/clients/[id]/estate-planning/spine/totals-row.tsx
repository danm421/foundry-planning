import MoneyText from "@/components/money-text";

function TotalBox({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded p-3 border border-hair">
      <div className="text-[11px] uppercase tracking-wider text-ink-3">{label}</div>
      <MoneyText value={value} size="kpi" className="text-ink" />
    </div>
  );
}

/** The spine's closing totals. Lifetime gifts sit in their own box beside the
 *  at-death figures — and only when the plan made some — so Total to Heirs
 *  reads what the heirs receive in all. */
export function TotalsRow({
  taxesAndExpenses,
  toHeirs,
  lifetimeGifts,
}: {
  taxesAndExpenses: number;
  toHeirs: number;
  lifetimeGifts: number;
}) {
  const showGifts = lifetimeGifts > 0;
  return (
    <div className={`grid ${showGifts ? "grid-cols-3" : "grid-cols-2"} gap-2 my-3`}>
      <TotalBox label="Total Taxes & Expenses" value={taxesAndExpenses} />
      {showGifts && <TotalBox label="Lifetime Gifts to Heirs" value={lifetimeGifts} />}
      <TotalBox label="Total to Heirs" value={toHeirs + lifetimeGifts} />
    </div>
  );
}
