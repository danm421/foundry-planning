import { formatCompact } from "@/lib/format-compact";
import type { PlanSettings } from "@/engine/types";
import type {
  EquityTaxImpactModel,
  EquityTaxImpactRow,
} from "@/engine/equity/tax-impact";

/** The plan's tax method, as the engine spells it. */
export type TaxMode = NonNullable<PlanSettings["taxEngineMode"]>;

const dash = <span className="text-ink-4">—</span>;
const notModelled = <span className="font-sans text-[11px] text-ink-3">not modelled</span>;
const money = (n: number): React.ReactNode => (Math.round(n) === 0 ? dash : formatCompact(n));
function moneyTone(n: number): React.ReactNode {
  if (Math.round(n) === 0) return dash;
  return <span className={n < 0 ? "text-crit" : "text-good"}>{formatCompact(n)}</span>;
}
/** The bargain element, or the reason there is no tax behind it — see `copyFor`. */
const isoCell = (n: number, taxMode: TaxMode): React.ReactNode =>
  taxMode === "flat" ? notModelled : money(n);

const TH = "px-2 py-1.5 text-right align-bottom max-w-[5.5rem] cursor-help leading-tight text-[10px] font-bold uppercase tracking-[0.04em] text-ink-2";
const TD = "px-2 py-1.5 text-right whitespace-nowrap border-b border-hair";
const TDF = `${TD} border-t-2 border-hair-2`; // totals-row cell (heavier top rule)
const L = "text-left";

/** EVERY sentence in this table that changes with the tax method, in one place.
 *
 *  Flat-rate mode hardcodes AMT to zero and never receives the option spread
 *  (`engine/tax.ts`), so the table renders a populated ISO Spread column against
 *  $0 of tax while three separate sentences promise that spread's tax "sits
 *  inside Federal Income Tax". Bracket mode computes the AMT for real, but shows
 *  it as a PERMANENT cost: the minimum tax credit that gives it back over the
 *  following years is not modelled, so the lifetime total overstates what
 *  exercising and holding costs — on the very screen an advisor uses to decide
 *  whether to exercise and hold.
 *
 *  One owner because a tooltip and a footnote saying the same thing in two
 *  places is exactly where one arm gets corrected and the other does not. */
function copyFor(taxMode: TaxMode) {
  return taxMode === "flat"
    ? {
        isoSpread:
          "AMT is not modelled in flat-rate mode, so an ISO exercise adds no tax here. Switch the plan's tax method to bracket-based under Assumptions to price one.",
        fedIncomeTax:
          "Additional federal income tax the plan owes because of this year's equity comp. AMT is not modelled in flat-rate mode.",
        footnoteLead: "AMT is not modelled in flat-rate mode",
        footnoteRest:
          ", so an ISO exercise adds no tax to these figures. Switch the plan's tax method to bracket-based under Assumptions to price one.",
      }
    : {
        isoSpread:
          "Bargain element on ISO exercises — an AMT preference item (informational). Its tax is included in Federal Income Tax and it is not added to Total Option Income & Gains. That AMT is shown as a permanent cost: the credit that gives it back in later years is not modelled yet.",
        fedIncomeTax:
          "Additional regular federal income tax plus AMT the plan owes because of this year's equity comp.",
        footnoteLead: "ISO Spread",
        footnoteRest:
          " is the AMT preference (its tax sits inside Federal Income Tax) and is not added into income & gains. Foundry does not model the minimum tax credit yet, so that AMT never comes back here and the lifetime total overstates the cost of exercising and holding.",
      };
}

export default function EquityTaxImpactTable({
  model,
  taxMode,
}: {
  model: EquityTaxImpactModel;
  taxMode: TaxMode;
}) {
  if (!model.hasActivity) {
    return <div className="py-16 text-center text-sm text-ink-3">No tax impact from stock options for this client.</div>;
  }
  const copy = copyFor(taxMode);

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
            <Th tip={copy.isoSpread}>ISO Spread</Th>
            <Th tip="Long- and short-term capital gains realized on option shares sold this year.">
              Capital Gains from Options
            </Th>
            <Th tip="Earned Income from Options plus Capital Gains from Options (excludes the ISO spread).">
              Total Option Income &amp; Gains
            </Th>
            <Th tip={copy.fedIncomeTax}>Federal Income Tax</Th>
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
            <Row key={row.year} row={row} taxMode={taxMode} />
          ))}
        </tbody>
        <tfoot>
          <tr className="font-bold text-ink">
            <td className={`${TDF} ${L}`}>Totals</td>
            <td className={TDF}>{money(model.totals.ordinaryIncome)}</td>
            <td className={TDF}>{isoCell(model.totals.isoSpread, taxMode)}</td>
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
        <span className="text-ink-2 font-semibold">{copy.footnoteLead}</span>
        {copy.footnoteRest}
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

function Row({ row, taxMode }: { row: EquityTaxImpactRow; taxMode: TaxMode }) {
  return (
    <tr>
      <td className={`${TD} ${L} font-semibold text-ink-2`}>{row.year}</td>
      <td className={TD}>{money(row.ordinaryIncome)}</td>
      <td className={TD}>{isoCell(row.isoSpread, taxMode)}</td>
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
