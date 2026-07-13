"use client";

import type { Observation } from "@/lib/tax-analysis/types";
import { fmtUsd, fmtPct } from "@/lib/tax-analysis/format";
import { deductionDetailRows, incomeCompositionTotal } from "@/lib/tax-analysis/breakdowns";
import { BracketMapBars } from "./bracket-map-bars";
import type { YearDetail } from "./tax-analysis-content";

const GROUPS: Array<{ severity: Observation["severity"]; heading: string }> = [
  { severity: "opportunity", heading: "Opportunities" },
  { severity: "watch", heading: "Watch items" },
  { severity: "info", heading: "Notes" },
];

function KeyFigure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col rounded border border-hair bg-card p-3">
      <span className="text-xs uppercase text-ink-3">{label}</span>
      <span className="text-lg font-semibold tabular-nums">{value}</span>
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

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
        <KeyFigure label="Total income" value={k.totalIncome != null ? fmtUsd(k.totalIncome) : "—"} />
        <KeyFigure label="AGI" value={k.agi != null ? fmtUsd(k.agi) : "—"} />
        <KeyFigure label="Taxable income" value={k.taxableIncome != null ? fmtUsd(k.taxableIncome) : "—"} />
        <KeyFigure label="Total tax" value={k.totalTax != null ? fmtUsd(k.totalTax) : "—"} />
        <KeyFigure label="Effective rate" value={k.effectiveRate != null ? fmtPct(k.effectiveRate) : "—"} />
        <KeyFigure label="Marginal rate" value={k.marginalRate != null ? fmtPct(k.marginalRate) : "—"} />
        <KeyFigure
          label={k.refund != null && k.refund > 0 ? "Refund" : "Owed at filing"}
          value={
            k.refund != null && k.refund > 0
              ? fmtUsd(k.refund)
              : k.amountOwed != null ? fmtUsd(k.amountOwed) : "—"
          }
        />
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
                <th className="py-1 font-normal">Source</th>
                <th className="py-1 text-right font-normal">Amount</th>
                <th className="py-1 text-right font-normal">% of total</th>
              </tr>
            </thead>
            <tbody>
              {a.incomeComposition.map((r) => (
                <tr key={r.key} className="border-b border-hair">
                  <td className="py-1">{r.label}</td>
                  <td className="py-1 text-right tabular-nums">{fmtUsd(r.amount)}</td>
                  <td className="py-1 text-right tabular-nums">
                    {r.pctOfTotal != null ? fmtPct(r.pctOfTotal) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
            {(() => {
              const total = incomeCompositionTotal(k.totalIncome);
              if (!total) return null;
              return (
                <tfoot>
                  <tr className="border-t-2 border-hair font-medium">
                    <td className="py-1">Total income</td>
                    <td className="py-1 text-right tabular-nums">{total.amount}</td>
                    <td className="py-1 text-right tabular-nums">{total.pct}</td>
                  </tr>
                </tfoot>
              );
            })()}
          </table>
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

      {GROUPS.map(({ severity, heading }) => {
        const items = a.observations.filter((o) => o.severity === severity);
        if (items.length === 0) return null;
        return (
          <section key={severity}>
            <h3 className="mb-2 text-sm font-medium uppercase text-ink-3">{heading}</h3>
            <div className="flex flex-col gap-2">
              {items.map((o) => (
                <div key={o.id} className="rounded border border-hair bg-card p-4">
                  <p className="mb-1 font-medium">{o.title}</p>
                  <p className="text-sm text-ink-2">{o.body}</p>
                </div>
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

      <p className="text-xs text-ink-3">
        {a.reconstruction.withinTolerance === true &&
          "Cross-check: our independent computation of this return's pre-credit tax matches the filed amount. "}
        {a.reconstruction.withinTolerance === false &&
          `Cross-check: our computed pre-credit tax (${fmtUsd(a.reconstruction.computedPreCreditTax ?? 0)}) differs from the filed amount — verify the extracted figures. `}
        This analysis is informational, based on the return as provided, and is not tax advice.
      </p>
    </div>
  );
}
