import MoneyText from "@/components/money-text";

export function StageBand({
  kind,
  label,
  value,
}: {
  kind: "tax" | "inherit" | "heirs";
  label: string;
  value: number;
}) {
  const palette = {
    tax: "bg-tax/20 text-ink",
    inherit: "bg-inherit/20 text-ink",
    heirs: "bg-heirs/20 text-ink",
  }[kind];
  return (
    <div className={`rounded p-3 my-2 flex items-center justify-between ${palette}`}>
      <span className="text-[12px] uppercase tracking-wider">{label}</span>
      <MoneyText value={value} className="font-mono tabular-nums" />
    </div>
  );
}
