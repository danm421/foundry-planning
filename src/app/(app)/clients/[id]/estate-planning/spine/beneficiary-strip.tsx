import MoneyText from "@/components/money-text";
import type { BeneficiaryCard } from "./lib/derive-spine-data";

export function BeneficiaryStrip({ cards }: { cards: BeneficiaryCard[] }) {
  return (
    <div className="grid grid-cols-4 gap-2 my-3">
      {cards.map((c, i) => (
        <div key={i} className="rounded p-2 border border-hair">
          <div className="text-[13px] font-semibold">{c.isTrustRemainder ? `+ ${c.name}` : c.name}</div>
          {c.relationship && <div className="text-[11px] text-ink-3">{c.relationship}</div>}
          <MoneyText
            value={c.value}
            className={`text-[15px] font-mono ${c.isTrustRemainder ? "text-ink-2" : "text-accent-ink"}`}
          />
          <div className="text-[10.5px] uppercase tracking-wider text-ink-3">{Math.round(c.pctOfHeirs * 100)}%</div>
        </div>
      ))}
    </div>
  );
}
