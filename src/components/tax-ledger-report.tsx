// src/components/tax-ledger-report.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { runProjection } from "@/engine";
import type { ClientData, ProjectionYear } from "@/engine/types";
import type { FilingStatus } from "@/lib/tax/types";
import type { CellDrillContext } from "@/lib/tax/cell-drill/types";
import { equityPlanLabel } from "@/lib/tax/cell-drill/equity-plan-label";
import { buildTaxLedger } from "@/lib/tax-ledger";
import TaxLedgerDiagnosticsHeader from "@/components/tax-ledger/tax-ledger-diagnostics-header";
import TaxLedgerTable from "@/components/tax-ledger/tax-ledger-table";
import TaxLedgerFilters, { type LedgerFilterState } from "@/components/tax-ledger/tax-ledger-filters";

interface Props {
  clientId: string;
  scenarioId?: string | "base";
}

export default function TaxLedgerReport({ clientId }: Props) {
  const searchParams = useSearchParams();
  const [clientData, setClientData] = useState<ClientData | null>(null);
  const [years, setYears] = useState<ProjectionYear[]>([]);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<LedgerFilterState>({ characters: new Set(), hideNonTaxable: false, hideZero: true });

  useEffect(() => {
    setClientData(null);
    setYears([]);
    setSelectedYear(null);
    setError(null);
    setLoading(true);
    async function load() {
      try {
        const scenarioParam = searchParams?.get("scenario");
        const url = scenarioParam
          ? `/api/clients/${clientId}/projection-data?scenario=${encodeURIComponent(scenarioParam)}`
          : `/api/clients/${clientId}/projection-data`;
        const res = await fetch(url);
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const data = (await res.json()) as ClientData;
        const projected = runProjection(data);
        setClientData(data);
        setYears(projected);
        setSelectedYear(projected[0]?.year ?? null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load projection data");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [clientId, searchParams]);

  const ctx: CellDrillContext = useMemo(() => {
    const accountNames: Record<string, string> = {};
    for (const acc of clientData?.accounts ?? []) accountNames[acc.id] = acc.name;
    return {
      accountNames,
      incomes: clientData?.incomes ?? [],
      accounts: clientData?.accounts ?? [],
      entityNames: (clientData?.entities ?? []).reduce<Record<string, string>>((acc, e) => { if (e.name) acc[e.id] = e.name; return acc; }, {}),
      rothConversionNames: (clientData?.rothConversions ?? []).reduce<Record<string, string>>((acc, r) => { if (r.name) acc[r.id] = r.name; return acc; }, {}),
      noteNames: (clientData?.notesReceivable ?? []).reduce<Record<string, string>>((acc, n) => { if (n.name) acc[n.id] = n.name; return acc; }, {}),
      equityPlanNames: (clientData?.stockOptionPlans ?? []).reduce<Record<string, string>>((acc, p) => { if (p.accountId) acc[p.accountId] = equityPlanLabel(p); return acc; }, {}),
    };
  }, [clientData]);

  const ledger = useMemo(() => {
    const year = years.find((y) => y.year === selectedYear);
    if (!year || !clientData) return null;
    const filingStatus = (clientData.client?.filingStatus ?? "married_joint") as FilingStatus;
    return buildTaxLedger(year, ctx, { householdLabel: "Household", filingStatus });
  }, [years, selectedYear, ctx, clientData]);

  if (loading) return <div className="p-6 text-ink-2">Loading…</div>;
  if (error) return <div className="p-6 text-crit">Error: {error}</div>;
  if (!ledger) return <div className="p-6 text-ink-2">No projection data.</div>;

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-ink">Tax Ledger</h1>
        <label className="flex items-center gap-2 text-sm text-ink-2">
          Year
          <select
            className="rounded-md border border-hair bg-card px-2 py-1 text-ink"
            value={selectedYear ?? ""}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
          >
            {years.map((y) => (
              <option key={y.year} value={y.year}>{y.year}</option>
            ))}
          </select>
        </label>
      </div>
      <TaxLedgerDiagnosticsHeader d={ledger.diagnostics} />
      <TaxLedgerFilters state={filter} onChange={setFilter} />
      <TaxLedgerTable ledger={ledger} filter={filter} />
    </div>
  );
}
