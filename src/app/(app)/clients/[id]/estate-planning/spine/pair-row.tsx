import MoneyText from "@/components/money-text";

export function PairRow({
  client,
  spouse,
}: {
  client: { name: string; netWorth: number };
  spouse: { name: string; netWorth: number };
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {[client, spouse].map((p, i) => (
        <div key={i} className="rounded border border-spouse/30 bg-spouse/10 p-3">
          <div className="text-[11px] uppercase tracking-wider text-ink-3">{p.name}&apos;s Net Worth</div>
          <MoneyText value={p.netWorth} size="kpi" className="text-ink" />
        </div>
      ))}
    </div>
  );
}
