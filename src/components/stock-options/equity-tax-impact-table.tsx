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

const TH = "px-2 py-1.5 text-right align-bottom max-w-[5.5rem] cursor-help leading-tight text-[10px] font-bold uppercase tracking-[0.04em] text-ink-2";
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
            <Th left tip="Calendar year of the plan projection.">Year</Th>
            <Th tip="Ordinary income from equity comp this year — RSU vest value, NQSO exercise spread, and ordinary income from disqualifying ISO dispositions.">
              Earned Income from Options
            </Th>
            <Th tip="Bargain element on ISO exercises — an AMT preference item (informational). Its tax is included in Federal Income Tax and it is not added to Total Option Income & Gains.">
              ISO Spread
            </Th>
            <Th tip="Long- and short-term capital gains realized on option shares sold this year.">
              Capital Gains from Options
            </Th>
            <Th tip="Earned Income from Options plus Capital Gains from Options (excludes the ISO spread).">
              Total Option Income &amp; Gains
            </Th>
            <Th tip="Additional regular federal income tax plus AMT the plan owes because of this year's equity comp.">
              Federal Income Tax
            </Th>
            <Th tip="Additional federal capital-gains tax and NIIT — including options income pushing the client's other gains into a higher bracket.">
              Capital Gains Tax
            </Th>
            <Th tip="Additional FICA — Social Security (OASDI), Medicare, and the 0.9% additional Medicare surtax.">
              Payroll Tax
            </Th>
            <Th tip="Additional state income tax attributable to the equity comp.">State Tax</Th>
            <Th tip="Sum of Federal Income, Capital Gains, Payroll, and State tax — the total additional tax from equity comp this year.">
              Total Option Tax
            </Th>
            <Th tip="Total Option Income & Gains minus Total Option Tax — what the client keeps after tax.">
              Net Option Income
            </Th>
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

// Column header: wraps its label and carries a hover tooltip (native title — it
// can't be clipped by the surrounding overflow-x-auto scroll container).
function Th({ children, tip, left }: { children: React.ReactNode; tip: string; left?: boolean }) {
  return (
    <th title={tip} className={`${TH}${left ? ` ${L}` : ""}`}>
      {children}
    </th>
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
