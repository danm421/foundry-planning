import MoneyText from "@/components/money-text";

export function CombinedBlock({ value }: { value: number }) {
  return (
    <div className="rounded border border-spouse/30 bg-spouse/15 p-4 text-center my-2">
      <div className="text-[11px] uppercase tracking-wider text-ink-3">Combined estate</div>
      <MoneyText value={value} size="kpi" className="text-ink" />
    </div>
  );
}
