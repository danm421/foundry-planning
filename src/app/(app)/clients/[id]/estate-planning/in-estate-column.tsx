import type { ClientData } from "@/engine/types";
import { deriveClientCardData } from "./lib/derive-card-data";
import { ClientCard } from "./cards/client-card";

export function InEstateColumn({ tree, asOfYear }: { tree: ClientData; asOfYear: number }) {
  const cards = deriveClientCardData(tree, asOfYear);
  const total = cards.reduce((s, c) => s + c.outrightTotal + c.jointHalfTotal, 0);
  return (
    <div>
      <header className="flex items-baseline justify-between border-b border-[var(--color-hair)] px-5 py-3">
        <span className="text-[10.5px] uppercase tracking-[0.14em] text-[var(--color-ink-3)]">In Estate</span>
        <span className="text-[13px] font-semibold tabular-nums text-[var(--color-ink)]">
          {total.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}
        </span>
      </header>
      {cards.length === 0 ? (
        <div className="px-5 py-8 text-center text-[12px] text-[var(--color-ink-3)]">No grantors with assets.</div>
      ) : (
        <div>{cards.map((c) => <ClientCard key={c.ownerKey} data={c} />)}</div>
      )}
    </div>
  );
}
