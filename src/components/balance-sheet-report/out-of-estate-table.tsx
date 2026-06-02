// src/components/balance-sheet-report/out-of-estate-table.tsx
import type { BalanceSheetViewModel } from "./view-model";

const fmt = (n: number) =>
  n === 0 ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

interface OutOfEstateTableProps {
  vm: Pick<BalanceSheetViewModel, "outOfEstateOwnerRows" | "outOfEstateNetWorth" | "selectedYear">;
}

export default function OutOfEstateTable({ vm }: OutOfEstateTableProps) {
  if (vm.outOfEstateOwnerRows.length === 0) return null;
  return (
    <div className="overflow-hidden rounded-lg border border-hair bg-card">
      <div className="bg-paper px-3 py-2 text-[11px] uppercase tracking-wide text-ink-3">
        Out of Estate
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-ink-3">
            <th className="px-3 py-2 font-medium">Owner</th>
            <th className="px-3 py-2 text-right font-medium">Net ({vm.selectedYear})</th>
          </tr>
        </thead>
        <tbody>
          {vm.outOfEstateOwnerRows.map((r) => (
            <tr key={r.ownerKey} className="border-t border-hair">
              <td className="px-3 py-1.5 text-ink-2">{r.ownerName}</td>
              <td className={`px-3 py-1.5 text-right tabular-nums ${r.net < 0 ? "text-crit" : "text-ink"}`}>{fmt(r.net)}</td>
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
