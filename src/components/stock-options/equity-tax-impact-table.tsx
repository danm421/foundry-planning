import { formatCompact } from "@/lib/format-compact";
import type {
  EquityTaxImpactModel,
  EquityTaxImpactRow,
} from "@/engine/equity/tax-impact";

const dash = <span className="text-ink-4">—</span>;
const money = (n: number): React.ReactNode => (Math.round(n) === 0 ? dash : formatCompact(n));
function moneyTone(n: number): React.ReactNode {
  if (Math.round(n) === 0) return dash;
  return <span className={n < 0 ? "text-crit" : "text-good"}>{formatCompact(n)}</span>;
}

const TH = "px-2 py-1.5 text-right whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.04em] text-ink-4";
const TD = "px-2 py-1.5 text-right whitespace-nowrap border-b border-hair";
const TDF = `${TD} border-t-2 border-hair-2`; // totals-row cell (heavier top rule)
const L = "text-left";

export default function EquityTaxImpactTable({ model }: { model: EquityTaxImpactModel }) {
  if (!model.hasActivity) {
    return <div className="py-16 text-center text-sm text-ink-3">No tax impact from stock options for this client.</div>;
  }

  return (
    <div className="overflow-x-auto">
      <div className="mb-3 text-[11px] text-ink-3">
        additional tax the plan incurs because of equity compensation · per year
      </div>

      <table className="w-full border-collapse text-[12.5px] tabular-nums">
        <thead>
          <tr>
            <th className={`${TH} ${L}`}>Year</th>
            <th className={TH}>Earned Income from Options</th>
            <th className={TH}>ISO Spread</th>
            <th className={TH}>Capital Gains from Options</th>
            <th className={TH}>Total Option Income &amp; Gains</th>
            <th className={TH}>Federal Income Tax</th>
            <th className={TH}>Capital Gains Tax</th>
            <th className={TH}>Payroll Tax</th>
            <th className={TH}>State Tax</th>
            <th className={TH}>Total Option Tax</th>
            <th className={TH}>Net Option Income</th>
          </tr>
        </thead>
        <tbody>
          {model.rows.map((row) => (
            <Row key={row.year} row={row} />
          ))}
        </tbody>
        <tfoot>
          <tr className="font-bold text-ink">
            <td className={`${TDF} ${L}`}>Totals</td>
            <td className={TDF}>{money(model.totals.ordinaryIncome)}</td>
            <td className={TDF}>{money(model.totals.isoSpread)}</td>
            <td className={TDF}>{money(model.totals.capitalGains)}</td>
            <td className={TDF}>{money(model.totals.totalIncome)}</td>
            <td className={TDF}>{money(model.totals.fedIncomeTax)}</td>
            <td className={TDF}>{money(model.totals.capGainsTax)}</td>
            <td className={TDF}>{money(model.totals.payrollTax)}</td>
            <td className={TDF}>{money(model.totals.stateTax)}</td>
            <td className={TDF}>{money(model.totals.totalTax)}</td>
            <td className={TDF}>{moneyTone(model.totals.netIncome)}</td>
          </tr>
        </tfoot>
      </table>

      <p className="mt-3 text-[11px] text-ink-3">
        Each year shows the additional tax vs. a plan with no equity comp that year.
        The gains tax column reflects options income pushing the client&apos;s other
        gains into a higher bracket.{" "}
        <span className="text-ink-2 font-semibold">ISO Spread</span> is the AMT preference (its tax
        sits inside Federal Income Tax) and is not added into income &amp; gains.
      </p>
    </div>
  );
}

function Row({ row }: { row: EquityTaxImpactRow }) {
  return (
    <tr>
      <td className={`${TD} ${L} font-semibold text-ink-2`}>{row.year}</td>
      <td className={TD}>{money(row.ordinaryIncome)}</td>
      <td className={TD}>{money(row.isoSpread)}</td>
      <td className={TD}>{money(row.capitalGains)}</td>
      <td className={TD}>{money(row.totalIncome)}</td>
      <td className={TD}>{money(row.fedIncomeTax)}</td>
      <td className={TD}>{money(row.capGainsTax)}</td>
      <td className={TD}>{money(row.payrollTax)}</td>
      <td className={TD}>{money(row.stateTax)}</td>
      <td className={TD}>{money(row.totalTax)}</td>
      <td className={TD}>{moneyTone(row.netIncome)}</td>
    </tr>
  );
}
