import MoneyText from "@/components/money-text";

export function TotalsRow({
  taxesAndExpenses,
  toHeirs,
}: {
  taxesAndExpenses: number;
  toHeirs: number;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 my-3">
      <div className="rounded p-3 border border-hair">
        <div className="text-[11px] uppercase tracking-wider text-ink-3">Total Taxes &amp; Expenses</div>
        <MoneyText value={taxesAndExpenses} size="kpi" className="text-ink" />
      </div>
      <div className="rounded p-3 border border-hair">
        <div className="text-[11px] uppercase tracking-wider text-ink-3">Total to Heirs</div>
        <MoneyText value={toHeirs} size="kpi" className="text-ink" />
      </div>
    </div>
  );
}
