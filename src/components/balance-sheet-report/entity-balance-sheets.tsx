// src/components/balance-sheet-report/entity-balance-sheets.tsx
import type { BalanceSheetViewModel } from "./view-model";
import { prepareEntityGroups } from "@/lib/balance-sheet/entity-groups";

const fmt = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const ENTITY_TYPE_LABEL: Record<string, string> = {
  trust: "Trust",
  llc: "LLC",
  s_corp: "S-Corp",
  c_corp: "C-Corp",
  partnership: "Partnership",
  sole_prop: "Sole Prop",
  foundation: "Foundation",
  other: "Entity",
};

interface EntityBalanceSheetsProps {
  groups: NonNullable<BalanceSheetViewModel["entityGroups"]>;
}

export default function EntityBalanceSheets({ groups }: EntityBalanceSheetsProps) {
  const cleaned = prepareEntityGroups(groups);
  if (cleaned.length === 0) {
    return <div className="w-full max-w-sm rounded-lg border border-hair bg-card p-6 text-center text-ink-2">No business or trust entities.</div>;
  }
  return (
    <div className="flex w-full max-w-sm flex-col gap-4">
      {cleaned.map((g) => (
        <div key={g.entityId} className="overflow-hidden rounded-lg border border-hair bg-card">
          <div className="flex items-baseline justify-between bg-paper px-4 py-2.5">
            <div className="flex items-baseline gap-2">
              <span className="font-semibold text-ink">{g.entityName}</span>
              <span className="rounded border border-hair-2 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-ink-3">
                {ENTITY_TYPE_LABEL[g.entityType] ?? g.entityType}
              </span>
            </div>
            <span className={`font-semibold tabular-nums ${g.netWorth < 0 ? "text-crit" : "text-ink"}`}>{fmt(g.netWorth)}</span>
          </div>
          <table className="w-full text-sm">
            <tbody>
              {g.assetRows.map((r) => (
                <tr key={r.rowKey} className="border-t border-hair">
                  <td className="px-4 py-1.5 pl-8 text-ink-2">{r.accountName}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums text-ink">{fmt(r.value)}</td>
                </tr>
              ))}
              {g.liabilityRows.map((r) => (
                <tr key={r.rowKey} className="border-t border-hair">
                  <td className="px-4 py-1.5 pl-8 text-ink-2">{r.liabilityName}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums text-crit">({fmt(r.balance)})</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
