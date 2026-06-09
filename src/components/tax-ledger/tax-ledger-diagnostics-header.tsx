// src/components/tax-ledger/tax-ledger-diagnostics-header.tsx
"use client";

import { formatCurrency } from "@/lib/tax/cell-drill/_shared";
import type { TaxLedgerDiagnostics } from "@/lib/tax-ledger";

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-hair bg-card px-3 py-2">
      <div className="text-[11px] uppercase tracking-wider text-ink-3">{label}</div>
      <div className="text-base font-semibold tabular-nums text-ink">{value}</div>
      {hint ? <div className="text-[11px] text-ink-3">{hint}</div> : null}
    </div>
  );
}

export default function TaxLedgerDiagnosticsHeader({ d }: { d: TaxLedgerDiagnostics }) {
  const irmaaHint =
    d.irmaa.tier == null ? undefined
    : d.irmaa.headroomToNextTier == null || !Number.isFinite(d.irmaa.headroomToNextTier)
      ? "top tier"
      : `${formatCurrency(d.irmaa.headroomToNextTier)} to next`;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        <Tile label="Total tax" value={formatCurrency(d.totalTax)} hint={`${formatCurrency(d.totalFederalTax)} fed · ${formatCurrency(d.totalStateTax)} state`} />
        <Tile label="AGI" value={formatCurrency(d.agi)} />
        <Tile label="Taxable income" value={formatCurrency(d.taxableIncome)} />
        <Tile label="Eff. / marg. rate" value={`${pct(d.effectiveRate)} / ${pct(d.marginalRate)}`} hint={d.bracketHeadroom != null ? `${formatCurrency(d.bracketHeadroom)} to next bracket` : undefined} />
        <Tile label="NIIT" value={d.niit.active ? formatCurrency(d.taxByType.niit) : "—"} hint={d.niit.active ? `on ${formatCurrency(d.niit.base)}` : d.niit.thresholdDistance != null && d.niit.thresholdDistance > 0 ? `${formatCurrency(d.niit.thresholdDistance)} under threshold` : undefined} />
        <Tile label="IRMAA tier" value={d.irmaa.tier == null ? "—" : `Tier ${d.irmaa.tier}`} hint={irmaaHint} />
        <Tile label="AMT" value={d.amt.bound ? formatCurrency(d.amt.additional) : "—"} hint={d.amt.bound ? "AMT applies" : undefined} />
        <Tile label="SS taxable" value={d.ssTaxablePercent == null ? "—" : pct(d.ssTaxablePercent)} />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-lg border border-hair bg-card-2 px-3 py-2 text-xs text-ink-2">
        <span>Fed ordinary <span className="font-semibold tabular-nums text-ink">{formatCurrency(d.taxByType.federalOrdinary)}</span></span>
        <span>Cap gains <span className="font-semibold tabular-nums text-ink">{formatCurrency(d.taxByType.capitalGains)}</span></span>
        <span>NIIT <span className="font-semibold tabular-nums text-ink">{formatCurrency(d.taxByType.niit)}</span></span>
        <span>FICA/Medicare <span className="font-semibold tabular-nums text-ink">{formatCurrency(d.taxByType.ficaMedicare)}</span></span>
        <span>AMT <span className="font-semibold tabular-nums text-ink">{formatCurrency(d.taxByType.amt)}</span></span>
        <span>Penalty <span className="font-semibold tabular-nums text-ink">{formatCurrency(d.taxByType.earlyWithdrawalPenalty)}</span></span>
        <span>State <span className="font-semibold tabular-nums text-ink">{formatCurrency(d.taxByType.state)}</span></span>
      </div>
    </div>
  );
}
