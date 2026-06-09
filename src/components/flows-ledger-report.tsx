// src/components/flows-ledger-report.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { runProjection } from "@/engine";
import type { ClientData, ProjectionYear } from "@/engine/types";
import { buildFlowsLedger, type FlowsLedgerContext, type FlowCategory, type OwnerKind } from "@/lib/flows-ledger";
import FlowsLedgerTable from "@/components/flows-ledger/flows-ledger-table";
import FlowsLedgerFilters, { type FlowsFilterState } from "@/components/flows-ledger/flows-ledger-filters";
import TaxLedgerYearPicker from "@/components/tax-ledger/tax-ledger-year-picker";

interface Props {
  clientId: string;
  scenarioId?: string | "base";
}

/** Map an entity's type to the ledger section kind (display only). */
function entityKind(entityType?: string): OwnerKind {
  if (entityType === "trust") return "trust";
  if (entityType === "foundation") return "charity";
  return "business";
}

export default function FlowsLedgerReport({ clientId }: Props) {
  const searchParams = useSearchParams();
  const [clientData, setClientData] = useState<ClientData | null>(null);
  const [years, setYears] = useState<ProjectionYear[]>([]);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FlowsFilterState>({ categories: new Set(), hideZero: true });

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

  const ctx: FlowsLedgerContext = useMemo(() => {
    const accountNames: Record<string, string> = {};
    const accountCategories: Record<string, string> = {};
    for (const acc of clientData?.accounts ?? []) {
      accountNames[acc.id] = acc.name;
      accountCategories[acc.id] = acc.category;
    }
    // Merge engine-minted synthetic accounts (equity-comp destinations).
    for (const y of years) {
      for (const syn of y.syntheticAccounts ?? []) {
        accountNames[syn.id] = syn.name;
        accountCategories[syn.id] = syn.category;
      }
    }
    const entityNames: Record<string, string> = {};
    const entityKinds: Record<string, OwnerKind> = {};
    for (const e of clientData?.entities ?? []) {
      if (e.name) entityNames[e.id] = e.name;
      entityKinds[e.id] = entityKind(e.entityType);
    }
    const accountEntityOwners = new Map<string, { entityId: string; percent: number }>();
    for (const acc of clientData?.accounts ?? []) {
      const owner = acc.owners.find((o) => o.kind === "entity");
      if (owner && owner.kind === "entity") {
        accountEntityOwners.set(acc.id, { entityId: owner.entityId, percent: owner.percent });
      }
    }
    return { accountNames, accountCategories, entityNames, entityKinds, accountEntityOwners };
  }, [clientData, years]);

  const ledger = useMemo(() => {
    const year = years.find((y) => y.year === selectedYear);
    if (!year) return null;
    return buildFlowsLedger(year, ctx);
  }, [years, selectedYear, ctx]);

  const presentCategories = useMemo<FlowCategory[]>(() => {
    if (!ledger) return [];
    const set = new Set<FlowCategory>();
    for (const s of ledger.sections) for (const a of s.accounts) for (const r of a.rows) set.add(r.category);
    return [...set];
  }, [ledger]);

  if (loading) return <div className="p-6 text-ink-2">Loading…</div>;
  if (error) return <div className="p-6 text-crit">Error: {error}</div>;
  if (!ledger) return <div className="p-6 text-ink-2">No projection data.</div>;

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-ink">Flows Ledger</h1>
        <label className="flex items-center gap-2 text-sm text-ink-2">
          Year
          <TaxLedgerYearPicker
            years={years.map((y) => ({ year: y.year, ages: y.ages }))}
            selectedYear={selectedYear}
            onSelect={setSelectedYear}
            clientName={clientData?.client?.firstName}
            spouseName={clientData?.client?.spouseName}
          />
        </label>
      </div>
      <FlowsLedgerFilters present={presentCategories} state={filter} onChange={setFilter} />
      <FlowsLedgerTable ledger={ledger} filter={filter} />
    </div>
  );
}
