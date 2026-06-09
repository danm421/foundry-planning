import { formatCompact } from "@/lib/format-compact";
import type {
  VestingScheduleModel,
  VestingScheduleRow,
} from "@/engine/equity/vesting-schedule";

const TYPE_LABEL: Record<string, string> = { rsu: "RSU", nqso: "NQSO", iso: "ISO" };

const sh = (n: number): string => (Math.round(n) === 0 ? "0" : Math.round(n).toLocaleString("en-US"));
const dash = <span className="text-ink-3">—</span>;

const TH = "px-2 py-1 text-right whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.03em] text-ink-3";
const TD = "px-2 py-1 text-right whitespace-nowrap border-b border-hair";
const L = "text-left";

function ExercisedCell({ row }: { row: VestingScheduleRow }) {
  if (!row.isOption) return dash;
  const split = row.grantType === "iso" ? row.isoSplit : null;
  if (split) {
    return (
      <span className="flex flex-col items-end leading-tight">
        <span>{sh(row.exercised ?? 0)}</span>
        <span className="text-[9px]">
          <span className="text-good">✓{sh(split.qualified)} qual</span>
          {" · "}
          <span className="text-warn">⧖{sh(split.holding)} hold</span>
        </span>
      </span>
    );
  }
  return <span>{sh(row.exercised ?? 0)}</span>;
}

export default function VestingScheduleTable({ model }: { model: VestingScheduleModel }) {
  if (model.rows.length === 0) {
    return (
      <div className="py-16 text-center text-sm text-ink-3">
        No stock option grants for this client.
      </div>
    );
  }

  const { yearColumns, plusLabel, rows, totals } = model;
  const yearHeaders = plusLabel ? [...yearColumns.map(String), plusLabel] : yearColumns.map(String);
  // Future-vesting cells per row, aligned to yearHeaders (+ plus bucket if present).
  const futureCells = (r: VestingScheduleRow) =>
    plusLabel ? [...r.futureByYear, r.futurePlus] : r.futureByYear;
  const totalFuture = plusLabel ? [...totals.futureByYear, totals.futurePlus] : totals.futureByYear;
  const totalFutureValue = plusLabel ? [...totals.estValueByYear, totals.estValuePlus] : totals.estValueByYear;

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[12px] tabular-nums">
        <thead>
          <tr>
            <th className={`${TH} ${L}`} colSpan={4}>Grant &amp; terms</th>
            <th className={`${TH} text-center`} colSpan={5}>Position to date</th>
            <th className={`${TH} text-center border-l border-hair`} colSpan={yearHeaders.length}>
              Future vesting (shares)
            </th>
            <th className={TH}></th>
          </tr>
          <tr>
            <th className={`${TH} ${L}`}>Grant</th>
            <th className={TH}>Type</th>
            <th className={TH}>Strike</th>
            <th className={TH}>Expires</th>
            <th className={TH}>Granted</th>
            <th className={TH}>Vested</th>
            <th className={TH}>Exercisable</th>
            <th className={TH}>Exercised</th>
            <th className={TH}>Sold</th>
            {yearHeaders.map((y, i) => (
              <th key={y} className={`${TH}${i === 0 ? " border-l border-hair" : ""}`}>{y}</th>
            ))}
            <th className={TH}>Unvested</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const cells = futureCells(r);
            return (
              <tr key={r.grantId}>
                <td className={`${TD} ${L} font-medium`}>{r.label}</td>
                <td className={TD}>{TYPE_LABEL[r.grantType] ?? r.grantType}</td>
                <td className={TD}>{r.strike != null ? `$${r.strike.toFixed(2)}` : dash}</td>
                <td className={TD}>{r.expirationYear ?? dash}</td>
                <td className={TD}>{sh(r.granted)}</td>
                <td className={`${TD} text-good`}>{sh(r.vested)}</td>
                <td className={TD}>{r.exercisable != null ? sh(r.exercisable) : dash}</td>
                <td className={TD}><ExercisedCell row={r} /></td>
                <td className={TD}>{sh(r.sold)}</td>
                {cells.map((c, i) => (
                  <td key={i} className={`${TD}${i === 0 ? " border-l border-hair" : ""}`}>
                    {c === 0 ? dash : sh(c)}
                  </td>
                ))}
                <td className={TD}>{sh(r.unvested)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="font-semibold">
            <td className={`${TD} ${L}`}>Total shares</td>
            <td className={TD} colSpan={3}></td>
            <td className={TD}>{sh(totals.granted)}</td>
            <td className={`${TD} text-good`}>{sh(totals.vested)}</td>
            <td className={TD}>{sh(totals.exercisable)}</td>
            <td className={TD}>{sh(totals.exercised)}</td>
            <td className={TD}>{sh(totals.sold)}</td>
            {totalFuture.map((c, i) => (
              <td key={i} className={`${TD}${i === 0 ? " border-l border-hair" : ""}`}>{sh(c)}</td>
            ))}
            <td className={TD}>{sh(totals.unvested)}</td>
          </tr>
          <tr className="text-ink-3">
            <td className={`${TD} ${L}`}>Est. value vesting</td>
            <td className={TD} colSpan={8}></td>
            {totalFutureValue.map((c, i) => (
              <td key={i} className={`${TD}${i === 0 ? " border-l border-hair" : ""}`}>
                {c === 0 ? dash : formatCompact(c)}
              </td>
            ))}
            <td className={TD}></td>
          </tr>
        </tfoot>
      </table>
      <p className="mt-2 text-[11px] text-ink-3">
        Vested = vested to date. Strike / Expires / Exercisable / Exercised apply to options only.
        ISO Exercised splits into <span className="text-good">✓ qual</span> (past the holding period — sells as LTCG)
        and <span className="text-warn">⧖ hold</span> (still in the window — selling now is a disqualifying disposition).
        ISO split assumes shares were exercised at vest.
      </p>
    </div>
  );
}
