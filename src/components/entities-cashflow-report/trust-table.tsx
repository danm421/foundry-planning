import type { TrustCashFlowRow } from "@/engine/types";
import type { LedgerSection } from "@/lib/entity-ledger";
import { TRUST_COLUMNS, formatCurrency, formatAges } from "./tokens";

interface Props {
  rows: TrustCashFlowRow[];
  currentYear: number;
  onCellClick?: (row: TrustCashFlowRow, section: LedgerSection) => void;
}

export default function TrustTable({ rows, currentYear, onCellClick }: Props) {
  const Cell = ({
    value,
    onClick,
  }: {
    value: number;
    onClick?: () => void;
  }) =>
    onClick ? (
      <button
        type="button"
        onClick={onClick}
        className="w-full text-right tabular-nums text-blue-300 hover:text-blue-200 hover:underline"
      >
        {formatCurrency(value)}
      </button>
    ) : (
      <>{formatCurrency(value)}</>
    );

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-gray-400">
          <tr className="border-b border-gray-800">
            {TRUST_COLUMNS.map((c) => (
              <th
                key={c.key}
                className="px-2 py-2 text-right text-xs font-normal align-bottom leading-tight first:text-left"
              >
                {c.label.map((line, i) => (
                  <span key={i} className="block whitespace-nowrap">
                    {line || " "}
                  </span>
                ))}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="text-gray-100">
          {rows.map((r) => {
            const isCurrent = r.year === currentYear;
            return (
              <tr
                key={r.year}
                className={`border-b border-gray-800/60 last:border-b-0 ${
                  isCurrent ? "bg-gray-800/40 font-semibold" : ""
                }`}
              >
                <td className="px-2 py-1.5 text-left tabular-nums">{r.year}</td>
                <td className="px-2 py-1.5 text-left tabular-nums">{formatAges(r.ages)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{formatCurrency(r.beginningBalance)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{formatCurrency(r.transfersIn)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  <Cell value={r.growth} onClick={onCellClick && (() => onCellClick(r, "growth"))} />
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  <Cell value={r.income} onClick={onCellClick && (() => onCellClick(r, "income"))} />
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">{formatCurrency(r.totalDistributions)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  <Cell value={r.expenses} onClick={onCellClick && (() => onCellClick(r, "expenses"))} />
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">{formatCurrency(r.taxes)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  <Cell value={r.endingBalance} onClick={onCellClick && (() => onCellClick(r, "ending"))} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
