"use client";

import type { Finding } from "@/lib/tax-analysis/types";
import { fmtUsd, fmtPct } from "@/lib/tax-analysis/format";
import {
  deductionDetailRows, hasGrossColumn, incomeCompositionHeaders, incomeCompositionTotal, keyFigureTiles,
} from "@/lib/tax-analysis/breakdowns";
import { activityDetailRows, type ActivityDetail } from "@/lib/tax-analysis/activity-detail";
import { reconstructionNote } from "@/lib/tax-analysis/reconstruction";
import { SEVERITY_GROUPS, CATEGORY_LABEL, FINDING_PARTS, sortFindings } from "@/lib/tax-analysis/findings/order";
import { formatLineRefs } from "@/lib/tax-analysis/findings/line-refs";
import { BracketMapBars } from "./bracket-map-bars";
import type { YearDetail } from "./tax-analysis-content";

/** Per-variant row/label classes. `detail` rows are components of the line
 *  above them; `memo` rows sit below the net and are not terms of its
 *  arithmetic. Keyed rather than nested ternaries so adding a variant can't
 *  leave one of the two cells behind. */
const ACTIVITY_VARIANT_CLASSES = {
  primary: { row: "", label: "" },
  detail: { row: "", label: "pl-4 text-ink-2" },
  total: { row: "border-t border-hair font-medium", label: "" },
  memo: { row: "text-ink-2", label: "" },
} as const;

function ActivityCard({ activity }: { activity: ActivityDetail }) {
  return (
    <div className="rounded border border-hair bg-card p-4">
      <p className="font-medium">{activity.title}</p>
      {activity.subtitle && <p className="mb-2 text-xs uppercase text-ink-3">{activity.subtitle}</p>}
      <table className="w-full border-collapse text-sm">
        <tbody>
          {activityDetailRows(activity).map((r) => {
            const c = ACTIVITY_VARIANT_CLASSES[r.variant];
            return (
              <tr key={r.label} className={c.row}>
                <td className={`py-1 ${c.label}`}>{r.label}</td>
                <td className="py-1 text-right tabular-nums">{r.value}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function KeyFigure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col rounded border border-hair bg-card p-3">
      <span className="text-xs uppercase text-ink-3">{label}</span>
      <span className="text-lg font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function FindingCard({ finding }: { finding: Finding }) {
  const refs = formatLineRefs(finding.lineRefs);
  return (
    <div id={`finding-${finding.id}`} className="scroll-mt-4 rounded border border-hair bg-card p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-medium">{finding.headline}</p>
          <span className="mt-1 inline-block rounded-full border border-hair px-2 py-0.5 text-[11px] uppercase tracking-wide text-ink-3">
            {CATEGORY_LABEL[finding.category]}
          </span>
        </div>
        {finding.estimatedImpact != null && (
          <div className="shrink-0 text-right">
            <span className="block text-[11px] uppercase text-ink-3">Est. impact</span>
            <span className="text-sm font-semibold tabular-nums">{fmtUsd(finding.estimatedImpact)}</span>
          </div>
        )}
      </div>
      <div className="mt-3 flex flex-col gap-2">
        {FINDING_PARTS.map(({ key, label }) =>
          finding[key] ? (
            <div key={key}>
              <p className="text-xs font-medium uppercase text-ink-3">{label}</p>
              <p className="text-sm text-ink-2">{finding[key]}</p>
            </div>
          ) : null,
        )}
      </div>
      {refs !== "" && <p className="mt-3 text-xs italic text-ink-3">{refs}</p>}
    </div>
  );
}

export function TaxReportView({
  clientId,
  detail,
  onEditFacts,
}: {
  clientId: string;
  detail: YearDetail;
  onEditFacts: () => void | Promise<void>;
}) {
  const a = detail.analysis!;
  const k = a.keyFigures;
  const incomeTotal = incomeCompositionTotal(k.totalIncome, k.grossIncome);
  // The gross COLUMN and the gross TILE turn on different tests — see
  // keyFigureTiles in breakdowns.ts, which owns the tile side for both surfaces.
  const showGrossColumn = a.incomeComposition != null && hasGrossColumn(a.incomeComposition);
  // Sorted once: the index and every group read the same array, so a jump link
  // can never point at a card the grouping dropped.
  const findings = sortFindings(a.findings);

  async function exportPdf() {
    const res = await fetch(`/api/clients/${clientId}/tax-returns/${detail.taxYear}/export-pdf`, { method: "POST" });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `tax-analysis-${detail.taxYear}.pdf`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{detail.taxYear} Tax Analysis</h2>
        <div className="flex gap-2">
          <button type="button" className="rounded border border-hair px-3 py-1.5 text-sm" onClick={onEditFacts}>
            Edit facts
          </button>
          <button type="button" className="btn-primary px-3 py-1.5 text-sm font-medium" onClick={exportPdf}>
            Export PDF
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {keyFigureTiles(k).map((t) => (
          <KeyFigure key={t.label} label={t.label} value={t.value} />
        ))}
      </div>

      {a.bracketMap && (
        <div className="rounded border border-hair bg-card p-4">
          <BracketMapBars map={a.bracketMap} />
        </div>
      )}

      {a.incomeComposition && (
        <section>
          <h3 className="mb-2 text-sm font-medium uppercase text-ink-3">Income composition</h3>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-hair text-left text-ink-3">
                {incomeCompositionHeaders(a.incomeComposition).map((h, i) => (
                  <th key={h} className={`py-1 font-normal${i === 0 ? "" : " text-right"}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {a.incomeComposition.map((r) => (
                <tr key={r.key} className="border-b border-hair">
                  <td className="py-1">{r.label}</td>
                  <td className="py-1 text-right tabular-nums">{fmtUsd(r.amount)}</td>
                  {showGrossColumn && (
                    <td className="py-1 text-right tabular-nums">{fmtUsd(r.gross)}</td>
                  )}
                  <td className="py-1 text-right tabular-nums">
                    {r.pctOfGross != null ? fmtPct(r.pctOfGross) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
            {incomeTotal && (
              <tfoot>
                <tr className="border-t-2 border-hair font-medium">
                  <td className="py-1">Total income</td>
                  <td className="py-1 text-right tabular-nums">{incomeTotal.amount}</td>
                  {showGrossColumn && (
                    <td className="py-1 text-right tabular-nums">{incomeTotal.gross}</td>
                  )}
                  <td className="py-1 text-right tabular-nums">{incomeTotal.pct}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </section>
      )}

      {a.activityDetail && (
        <section>
          <h3 className="mb-2 text-sm font-medium uppercase text-ink-3">
            Business &amp; rental detail
          </h3>
          <div className="flex flex-col gap-3">
            {a.activityDetail.map((activity) => (
              <ActivityCard key={activity.key} activity={activity} />
            ))}
          </div>
        </section>
      )}

      {a.deductionDetail && (
        <section>
          <h3 className="mb-2 text-sm font-medium uppercase text-ink-3">Deductions</h3>
          <table className="w-full border-collapse text-sm">
            <tbody>
              {deductionDetailRows(a.deductionDetail).map((r) => (
                <tr key={r.label} className="border-b border-hair">
                  <td className="py-1">{r.label}</td>
                  <td className="py-1 text-right tabular-nums">{r.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {findings.length > 0 && (
        <nav aria-label="Findings index" className="rounded border border-hair bg-card p-4">
          <h3 className="mb-2 text-sm font-medium uppercase text-ink-3">Findings</h3>
          <ol className="flex flex-col gap-1">
            {findings.map((f) => (
              <li key={f.id}>
                <a href={`#finding-${f.id}`} className="text-sm text-ink-2 underline-offset-2 hover:underline">
                  {f.headline}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      )}

      {SEVERITY_GROUPS.map(({ severity, heading }) => {
        const items = findings.filter((f) => f.severity === severity);
        if (items.length === 0) return null;
        return (
          <section key={severity}>
            <h3 className="mb-2 text-sm font-medium uppercase text-ink-3">{heading}</h3>
            <div className="flex flex-col gap-3">
              {items.map((f) => (
                <FindingCard key={f.id} finding={f} />
              ))}
            </div>
          </section>
        );
      })}

      {a.yoy && (
        <section>
          <h3 className="mb-2 text-sm font-medium uppercase text-ink-3">Year over year</h3>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-hair text-left text-ink-3">
                <th className="py-1 font-normal">Measure</th>
                <th className="py-1 text-right font-normal">Prior</th>
                <th className="py-1 text-right font-normal">{detail.taxYear}</th>
                <th className="py-1 text-right font-normal">Change</th>
              </tr>
            </thead>
            <tbody>
              {a.yoy.map((r) => {
                const f = (v: number | null) =>
                  v == null ? "—" : r.kind === "rate" ? fmtPct(v) : fmtUsd(v);
                return (
                  <tr key={r.label} className="border-b border-hair">
                    <td className="py-1">{r.label}</td>
                    <td className="py-1 text-right tabular-nums">{f(r.prior)}</td>
                    <td className="py-1 text-right tabular-nums">{f(r.current)}</td>
                    <td className="py-1 text-right tabular-nums">{f(r.delta)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      <p className="text-xs text-ink-3">{reconstructionNote(a.reconstruction)}</p>
    </div>
  );
}
