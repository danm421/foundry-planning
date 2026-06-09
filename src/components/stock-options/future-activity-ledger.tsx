import { formatCompact } from "@/lib/format-compact";
import type { GrantType } from "@/engine/equity/types";
import type {
  FutureActivityModel,
  FutureActivityEvent,
  FutureActivitySubtotal,
  FutureActivityKind,
} from "@/engine/equity/future-activity";

const TYPE_LABEL: Record<GrantType, string> = { rsu: "RSU", nqso: "NQSO", iso: "ISO" };
const KIND_LABEL: Record<FutureActivityKind, string> = {
  vest: "Vest", exercise: "Exercise", sell: "Sell", expire: "Expire",
};
// Dot colors via CSS vars (defined in globals.css for both themes).
const KIND_DOT: Record<FutureActivityKind, string> = {
  exercise: "var(--color-secondary-ink)",
  sell: "var(--color-good)",
  vest: "var(--color-cat-life)",
  expire: "var(--color-crit)",
};

const dash = <span className="text-ink-4">—</span>;
const sh = (n: number): string => (Math.round(n) === 0 ? "0" : Math.round(n).toLocaleString("en-US"));
const money = (n: number): React.ReactNode => (Math.round(n) === 0 ? dash : formatCompact(n));

const TH = "px-2.5 py-1.5 text-right whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.04em] text-ink-4";
const TD = "px-2.5 py-1.5 text-right whitespace-nowrap border-b border-hair";
const L = "text-left";

function EventCell({ e }: { e: FutureActivityEvent }) {
  return (
    <span className="inline-flex items-center gap-2 font-medium text-ink">
      <span className="inline-block h-[7px] w-[7px] rounded-[2px]" style={{ background: KIND_DOT[e.kind] }} />
      {KIND_LABEL[e.kind]}
      <span className="text-ink-2">{e.grantLabel}</span>
      <span className="text-ink-4 text-[11px]">{e.trancheLabel}</span>
      <span className="ml-0.5 rounded border border-hair-2 px-1 py-px text-[9.5px] font-bold tracking-[0.02em] text-ink-3">
        {TYPE_LABEL[e.grantType]}
      </span>
    </span>
  );
}

function moneyTone(n: number | null, tone: "pos-neg" | "neg" | "plain" = "plain"): React.ReactNode {
  if (n === null || Math.round(n) === 0) return dash;
  const cls = tone === "neg" ? "text-crit" : tone === "pos-neg" ? (n < 0 ? "text-crit" : "text-good") : "";
  return <span className={cls}>{formatCompact(n)}</span>;
}

function SubtotalRow({ label, s }: { label: string; s: FutureActivitySubtotal }) {
  return (
    <tr className="bg-accent-wash text-[11.5px] font-semibold text-ink-2">
      <td className={`${TD} ${L} uppercase tracking-[0.03em] text-[10px] text-ink-3`}>{label}</td>
      <td className={TD}>{sh(s.shares)}</td>
      <td className={TD}></td>
      <td className={TD}>{money(s.grossValue)}</td>
      <td className={TD}>{moneyTone(s.exerciseCost === 0 ? null : -s.exerciseCost, "neg")}</td>
      <td className={TD}>{moneyTone(s.netCash, "pos-neg")}</td>
      <td className={TD}>{dash}</td>
    </tr>
  );
}

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
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-3">
        <span>as of {model.asOfYear} · through plan end {model.planEndYear} · per-tranche</span>
        <span className="ml-auto flex flex-wrap gap-x-4 gap-y-1">
          {(["exercise", "sell", "vest", "expire"] as const).map((k) => (
            <span key={k} className="inline-flex items-center gap-1.5">
              <span className="inline-block h-[7px] w-[7px] rounded-[2px]" style={{ background: KIND_DOT[k] }} />
              {KIND_LABEL[k]}
            </span>
          ))}
        </span>
      </div>

      <table className="w-full border-collapse text-[12.5px] tabular-nums">
        <thead>
          <tr>
            <th className={`${TH} ${L}`}>Event</th>
            <th className={TH}>Shares</th>
            <th className={TH}>Price/sh</th>
            <th className={TH}>Gross value</th>
            <th className={TH}>Ex. cost</th>
            <th className={TH}>Net cash</th>
            <th className={TH}>Tax impact</th>
          </tr>
        </thead>
        <tbody>
          {model.groups.map((g) => (
            <YearGroup key={g.year} year={g.year} events={g.events} subtotal={g.subtotal} />
          ))}
        </tbody>
        <tfoot>
          <tr className="font-bold text-ink">
            <td className={`${TD} ${L} border-t-2 border-hair-2`}>Total</td>
            <td className={`${TD} border-t-2 border-hair-2`}>{sh(model.totals.shares)}</td>
            <td className={`${TD} border-t-2 border-hair-2`}></td>
            <td className={`${TD} border-t-2 border-hair-2`}>{money(model.totals.grossValue)}</td>
            <td className={`${TD} border-t-2 border-hair-2`}>{moneyTone(model.totals.exerciseCost === 0 ? null : -model.totals.exerciseCost, "neg")}</td>
            <td className={`${TD} border-t-2 border-hair-2`}>{moneyTone(model.totals.netCash, "pos-neg")}</td>
            <td className={`${TD} border-t-2 border-hair-2`}>{dash}</td>
          </tr>
        </tfoot>
      </table>

      <p className="mt-3 text-[11px] text-ink-3">
        <span className="text-ink-2 font-semibold">Tax impact</span> is wired but unpopulated this phase
        (shows <span className="italic text-ink-4">pending</span>). A future Tax Impact report computes
        tax(with equity) − tax(without equity) per year and feeds those numbers in. Price/sh is projected
        FMV; gross value = RSU FMV or option intrinsic; net cash = proceeds − strike (before
        sell-to-cover / withholding).
      </p>
    </div>
  );
}

function YearGroup({ year, events, subtotal }: { year: number; events: FutureActivityEvent[]; subtotal: FutureActivitySubtotal }) {
  return (
    <>
      <tr>
        <td colSpan={7} className="border-y border-hair bg-card-2 px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-accent-ink">
          {year}
        </td>
      </tr>
      {events.map((e, i) => (
        <tr key={`${e.grantId}:${e.trancheId}:${e.kind}:${i}`}>
          <td className={`${TD} ${L}`}><EventCell e={e} /></td>
          <td className={TD}>{sh(e.shares)}</td>
          <td className={TD}>
            <span className={e.kind === "expire" ? "text-ink-4" : ""}>${e.pricePerShare.toFixed(2)}</span>
          </td>
          <td className={TD}>
            {e.underwater
              ? <span className="text-warn text-[11px]">$0 · underwater ⚠</span>
              : money(e.grossValue)}
          </td>
          <td className={TD}>{moneyTone(e.exerciseCost === null ? null : -e.exerciseCost, "neg")}</td>
          <td className={TD}>{moneyTone(e.netCash, "pos-neg")}</td>
          <td className={TD}>
            {e.taxImpact === null
              ? (e.kind === "vest" || e.kind === "expire"
                  ? dash
                  : <span className="italic text-ink-4 text-[11px]">pending</span>)
              : formatCompact(e.taxImpact)}
          </td>
        </tr>
      ))}
      <SubtotalRow label={`${year} subtotal`} s={subtotal} />
    </>
  );
}
