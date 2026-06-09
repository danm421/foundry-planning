import { formatCompact } from "@/lib/format-compact";
import type { GrantType } from "@/engine/equity/types";
import type {
  FutureActivityModel,
  FutureActivityGrantYearRow,
  FutureActivitySubtotal,
} from "@/engine/equity/future-activity";

const TYPE_LABEL: Record<GrantType, string> = { rsu: "RSU", nqso: "NQSO", iso: "ISO" };
const OWNER_LABEL: Record<"client" | "spouse", string> = { client: "Client", spouse: "Spouse" };

const dash = <span className="text-ink-4">—</span>;
const sh = (n: number): React.ReactNode => (Math.round(n) === 0 ? dash : Math.round(n).toLocaleString("en-US"));
const money = (n: number): React.ReactNode => (Math.round(n) === 0 ? dash : formatCompact(n));
function moneyTone(n: number, tone: "pos-neg" | "neg" = "pos-neg"): React.ReactNode {
  if (Math.round(n) === 0) return dash;
  const cls = tone === "neg" ? "text-crit" : n < 0 ? "text-crit" : "text-good";
  return <span className={cls}>{formatCompact(n)}</span>;
}

// Tax Impact + After Tax populate only at the year-subtotal / grand-total level —
// taxImpact is a joint per-year counterfactual, so per-grant rows (taxImpact === null)
// fall through to a dash. A year with activity but no tax entry is also null → dash.
const taxCell = (taxImpact: number | null): React.ReactNode => (taxImpact === null ? dash : money(taxImpact));
const afterTaxCell = (netProceeds: number, taxImpact: number | null): React.ReactNode =>
  taxImpact === null ? dash : moneyTone(netProceeds - taxImpact);

const TH = "px-2 py-1.5 text-right whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.04em] text-ink-2";
const TD = "px-2 py-1.5 text-right whitespace-nowrap border-b border-hair";
const L = "text-left";
const COLS = 15;

export default function FutureActivityLedger({ model }: { model: FutureActivityModel }) {
  if (!model.hasGrants) {
    return <div className="py-16 text-center text-sm text-ink-3">No stock option grants for this client.</div>;
  }
  if (model.groups.length === 0) {
    return (
      <div className="py-16 text-center text-sm text-ink-3">
        No planned activity through {model.planEndYear}. See the Vesting Schedule for current holdings.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <div className="mb-3 text-[11px] text-ink-3">
        as of {model.asOfYear} · through plan end {model.planEndYear} · per-grant
      </div>

      <table className="w-full border-collapse text-[12.5px] tabular-nums">
        <thead>
          <tr>
            <th className={`${TH} ${L}`}>Owner</th>
            <th className={`${TH} ${L}`}>Plan</th>
            <th className={`${TH} ${L}`}>Grant #</th>
            <th className={`${TH} ${L}`}>Type</th>
            <th className={`${TH} ${L}`}>Grant Date</th>
            <th className={TH}>Sh. Vested</th>
            <th className={TH}>Sh. Exercised</th>
            <th className={TH}>Ex. Price</th>
            <th className={TH}>Ex. Cost</th>
            <th className={TH}>Sh. Sold</th>
            <th className={TH}>Sale $</th>
            <th className={TH}>Gross Proceeds</th>
            <th className={TH}>Net Proceeds</th>
            <th className={TH}>Tax Impact</th>
            <th className={TH}>After Tax</th>
          </tr>
        </thead>
        <tbody>
          {model.groups.map((g) => (
            <YearGroup key={g.year} year={g.year} rows={g.rows} subtotal={g.subtotal} />
          ))}
        </tbody>
        <tfoot>
          <tr className="font-bold text-ink">
            <td className={`${TD} ${L} border-t-2 border-hair-2`} colSpan={5}>Total</td>
            <td className={`${TD} border-t-2 border-hair-2`}>{sh(model.totals.sharesVested)}</td>
            <td className={`${TD} border-t-2 border-hair-2`}>{sh(model.totals.sharesExercised)}</td>
            <td className={`${TD} border-t-2 border-hair-2`}></td>
            <td className={`${TD} border-t-2 border-hair-2`}>{moneyTone(-model.totals.exerciseCost, "neg")}</td>
            <td className={`${TD} border-t-2 border-hair-2`}>{sh(model.totals.sharesSold)}</td>
            <td className={`${TD} border-t-2 border-hair-2`}></td>
            <td className={`${TD} border-t-2 border-hair-2`}>{money(model.totals.grossProceeds)}</td>
            <td className={`${TD} border-t-2 border-hair-2`}>{moneyTone(model.totals.netProceeds)}</td>
            <td className={`${TD} border-t-2 border-hair-2`}>{taxCell(model.totals.taxImpact)}</td>
            <td className={`${TD} border-t-2 border-hair-2`}>{afterTaxCell(model.totals.netProceeds, model.totals.taxImpact)}</td>
          </tr>
        </tfoot>
      </table>

      <p className="mt-3 text-[11px] text-ink-3">
        <span className="text-ink-2 font-semibold">Sh. Sold</span> includes shares auto-sold to cover
        withholding at vest/exercise (tagged <span className="text-accent-ink font-semibold">cover</span>)
        plus strategy sells; <span className="text-ink-2 font-semibold">Net Proceeds</span> = gross
        proceeds − exercise cost and reconciles with the cash flow.{" "}
        <span className="text-ink-2 font-semibold">Tax Impact</span> is the additional tax the plan
        incurs that year from equity comp (income + capital gains + payroll + state, from the Tax Impact
        report) — a joint per-year figure, so it shows on the year subtotals and total only, not per grant.{" "}
        <span className="text-ink-2 font-semibold">After Tax</span> = Net Proceeds − Tax Impact, netting
        cash proceeds against total additional tax (which includes tax on non-cash vest income).
      </p>
    </div>
  );
}

function YearGroup({ year, rows, subtotal }: { year: number; rows: FutureActivityGrantYearRow[]; subtotal: FutureActivitySubtotal }) {
  return (
    <>
      <tr>
        <td colSpan={COLS} className="border-y border-hair bg-card-2 px-2 py-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-accent-ink">
          {year}
        </td>
      </tr>
      {rows.map((r) => (
        <tr key={`${r.grantId}:${r.year}`}>
          <td className={`${TD} ${L}`}>{OWNER_LABEL[r.owner]}</td>
          <td className={`${TD} ${L}`}>{r.planLabel}</td>
          <td className={`${TD} ${L}`}>{r.grantNumber}</td>
          <td className={`${TD} ${L}`}>
            <span className="rounded border border-hair-2 px-1 py-px text-[9.5px] font-bold tracking-[0.02em] text-ink-3">
              {TYPE_LABEL[r.grantType]}
            </span>
          </td>
          <td className={`${TD} ${L}`}>{r.grantDate}</td>
          <td className={TD}>{sh(r.sharesVested)}</td>
          <td className={TD}>{sh(r.sharesExercised)}</td>
          <td className={TD}>{r.exercisePrice === null ? dash : `$${r.exercisePrice.toFixed(2)}`}</td>
          <td className={TD}>{moneyTone(-r.exerciseCost, "neg")}</td>
          <td className={TD}>
            {r.underwater && r.sharesSold === 0 ? (
              <span className="text-warn text-[11px]">{sh(r.expiredShares)} · underwater ⚠</span>
            ) : (
              <span className="inline-flex items-center justify-end gap-1">
                {sh(r.sharesSold)}
                {r.hasSellToCover && (
                  <span className="rounded bg-accent-wash px-1 text-[9px] font-semibold text-accent-ink">cover</span>
                )}
              </span>
            )}
          </td>
          <td className={TD}>{r.salePrice === 0 ? dash : `$${r.salePrice.toFixed(2)}`}</td>
          <td className={TD}>{money(r.grossProceeds)}</td>
          <td className={TD}>{moneyTone(r.netProceeds)}</td>
          <td className={TD}>{taxCell(r.taxImpact)}</td>
          <td className={TD}>{afterTaxCell(r.netProceeds, r.taxImpact)}</td>
        </tr>
      ))}
      <SubtotalRow label={`${year} subtotal`} s={subtotal} />
    </>
  );
}

function SubtotalRow({ label, s }: { label: string; s: FutureActivitySubtotal }) {
  return (
    <tr className="bg-accent-wash text-[11.5px] font-semibold text-ink-2">
      <td className={`${TD} ${L} uppercase tracking-[0.03em] text-[10px] text-ink-3`} colSpan={5}>{label}</td>
      <td className={TD}>{sh(s.sharesVested)}</td>
      <td className={TD}>{sh(s.sharesExercised)}</td>
      <td className={TD}></td>
      <td className={TD}>{moneyTone(-s.exerciseCost, "neg")}</td>
      <td className={TD}>{sh(s.sharesSold)}</td>
      <td className={TD}></td>
      <td className={TD}>{money(s.grossProceeds)}</td>
      <td className={TD}>{moneyTone(s.netProceeds)}</td>
      <td className={TD}>{taxCell(s.taxImpact)}</td>
      <td className={TD}>{afterTaxCell(s.netProceeds, s.taxImpact)}</td>
    </tr>
  );
}
