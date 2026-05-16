import MoneyText from "@/components/money-text";
import type { DeathTransfer } from "@/engine/types";

const MECH_LABEL: Record<DeathTransfer["via"], string> = {
  titling: "titling",
  beneficiary_designation: "beneficiary",
  will: "will",
  will_residuary: "remainder",
  will_liability_bequest: "will (debt)",
  fallback_spouse: "fallback",
  fallback_children: "fallback",
  fallback_other_heirs: "fallback",
  unlinked_liability_proportional: "debt share",
  trust_pour_out: "trust pour-out",
};

export function TransferRows({
  transfers,
  filter,
}: {
  transfers: DeathTransfer[];
  /** When set, only transfers to this recipientKind (and optional recipientId) are shown. */
  filter?: { recipientKind: DeathTransfer["recipientKind"]; recipientId?: string | null };
}) {
  const rows = transfers.filter((t) => {
    if (t.amount <= 0) return false;
    if (!filter) return true;
    if (t.recipientKind !== filter.recipientKind) return false;
    if (filter.recipientId !== undefined && t.recipientId !== filter.recipientId) return false;
    return true;
  });

  if (rows.length === 0) {
    return <p className="text-xs text-ink-3 italic">No transfers in this category.</p>;
  }

  // Group by recipient label (recipient-first, mechanism within).
  const byRecipient = new Map<string, DeathTransfer[]>();
  for (const t of rows) {
    const list = byRecipient.get(t.recipientLabel) ?? [];
    list.push(t);
    byRecipient.set(t.recipientLabel, list);
  }

  return (
    <div className="space-y-2 text-[12px]">
      {Array.from(byRecipient.entries()).map(([recipient, ts]) => (
        <div key={recipient}>
          <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-ink-3 border-b border-hair pb-0.5">
            <span>{recipient}</span>
            <span className="tabular-nums">
              <MoneyText value={ts.reduce((s, t) => s + t.amount, 0)} />
            </span>
          </div>
          <ul>
            {ts.map((t, i) => (
              <li key={i} className="flex items-center justify-between py-0.5 pl-3">
                <span className="flex items-center gap-2 truncate">
                  <span className="truncate text-ink-2">
                    {t.sourceAccountName ?? t.sourceLiabilityName ?? "—"}
                  </span>
                  <span className="rounded-sm bg-card px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-ink-3">
                    {MECH_LABEL[t.via]}
                  </span>
                </span>
                <MoneyText value={t.amount} className="tabular-nums text-ink" />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
