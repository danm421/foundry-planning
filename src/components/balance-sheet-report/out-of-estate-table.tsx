// src/components/balance-sheet-report/out-of-estate-table.tsx
import type { BalanceSheetViewModel } from "./view-model";

const fmt = (n: number) =>
  n === 0 ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

interface OutOfEstateTableProps {
  vm: Pick<BalanceSheetViewModel, "outOfEstateRows" | "outOfEstateLiabilityRows" | "outOfEstateNetWorth" | "selectedYear">;
}

export default function OutOfEstateTable({ vm }: OutOfEstateTableProps) {
  if (vm.outOfEstateRows.length === 0 && vm.outOfEstateLiabilityRows.length === 0) return null;
  return (
    <div className="overflow-hidden rounded-lg border border-hair bg-card">
      <div className="bg-paper px-3 py-2 text-[11px] uppercase tracking-wide text-ink-3">
        Out of Estate
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-ink-3">
            <th className="px-3 py-2 font-medium">Asset / Entity</th>
            <th className="px-3 py-2 text-right font-medium">Value ({vm.selectedYear})</th>
          </tr>
        </thead>
        <tbody>
          {vm.outOfEstateRows.map((r) => (
            <tr key={r.rowKey} className="border-t border-hair">
              <td className="px-3 py-1.5 text-ink-2">
                {r.ownerLabel && r.ownerLabel !== r.accountName ? `${r.ownerLabel} — ${r.accountName}` : r.accountName}
              </td>
              <td className="px-3 py-1.5 text-right tabular-nums text-ink">{fmt(r.value)}</td>
            </tr>
          ))}
          {vm.outOfEstateLiabilityRows.map((r) => (
            <tr key={r.rowKey} className="border-t border-hair">
              <td className="px-3 py-1.5 text-ink-2">{r.liabilityName}</td>
              <td className="px-3 py-1.5 text-right tabular-nums text-crit">({fmt(r.balance)})</td>
            </tr>
          ))}
          <tr className="border-t-2 border-hair-2 bg-paper font-semibold">
            <td className="px-3 py-2 text-ink">Net Out of Estate</td>
            <td className={`px-3 py-2 text-right tabular-nums ${vm.outOfEstateNetWorth < 0 ? "text-crit" : "text-good"}`}>
              {fmt(vm.outOfEstateNetWorth)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
