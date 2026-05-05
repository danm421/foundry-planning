import MoneyText from "@/components/money-text";
import type { DeathTransfer, EntitySummary } from "@/engine/types";
import type { TrustSubType } from "@/lib/entities/trust";

const SUBTYPE_PILL: Record<TrustSubType, string> = {
  revocable: "bg-cat-portfolio/15 text-cat-portfolio",
  irrevocable: "bg-warn/15 text-warn",
  ilit: "bg-warn/15 text-warn",
  slat: "bg-accent/15 text-accent-ink",
  crt: "bg-cat-life/15 text-cat-life",
  grat: "bg-cat-life/15 text-cat-life",
  qprt: "bg-cat-life/15 text-cat-life",
  clat: "bg-cat-life/15 text-cat-life",
  qtip: "bg-accent/15 text-accent-ink",
  bypass: "bg-accent/15 text-accent-ink",
};

export function TrustFundingRows({
  transfers,
  entities,
}: {
  transfers: DeathTransfer[];
  entities: EntitySummary[];
}) {
  const entityIds = new Set(entities.map((e) => e.id));
  const trustTransfers = transfers.filter(
    (t) =>
      t.amount > 0 &&
      t.recipientKind === "entity" &&
      t.recipientId != null &&
      entityIds.has(t.recipientId),
  );

  if (trustTransfers.length === 0) {
    return <p className="text-xs text-ink-3 italic">No trusts funded at this death.</p>;
  }

  // Group by trust id.
  const byTrust = new Map<
    string,
    { name: string; subType?: TrustSubType; amount: number }
  >();
  for (const t of trustTransfers) {
    const id = t.recipientId!;
    const ent = entities.find((e) => e.id === id);
    const existing = byTrust.get(id);
    if (existing) {
      existing.amount += t.amount;
    } else {
      byTrust.set(id, {
        name: ent?.name ?? t.recipientLabel,
        subType: ent?.trustSubType,
        amount: t.amount,
      });
    }
  }

  return (
    <ul className="space-y-1.5 text-[12px]">
      {Array.from(byTrust.entries()).map(([id, row]) => {
        const pillClass = row.subType ? SUBTYPE_PILL[row.subType] : null;
        return (
          <li
            key={id}
            className="flex items-center justify-between py-1 border-b border-hair last:border-b-0"
          >
            <span className="flex items-center gap-2">
              <span className="text-ink-2">{row.name}</span>
              {pillClass && row.subType && (
                <span
                  className={`rounded-sm px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-wider ${pillClass}`}
                >
                  {row.subType}
                </span>
              )}
            </span>
            <MoneyText value={row.amount} className="font-mono tabular-nums text-ink" />
          </li>
        );
      })}
    </ul>
  );
}
