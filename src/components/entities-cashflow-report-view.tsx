"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { runProjection } from "@/engine/projection";
import type { ProjectionYear } from "@/engine/types";
import HeaderControls, { type EntityOption } from "./entities-cashflow-report/header-controls";
import TrustTable from "./entities-cashflow-report/trust-table";
import BusinessTable from "./entities-cashflow-report/business-table";
import { selectEntityRows, type SelectedRows } from "./entities-cashflow-report/view-model";

interface Props {
  clientId: string;
  entities: EntityOption[];
}

export default function EntitiesCashFlowReportView({ clientId, entities }: Props) {
  const searchParams = useSearchParams();
  const [years, setYears] = useState<ProjectionYear[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedEntityId, setSelectedEntityId] = useState(entities[0]?.id ?? "");
  const [yearRange, setYearRange] = useState<[number, number] | null>(null);
  const [clientRetirementYear, setClientRetirementYear] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
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
        const data = await res.json();
        const projection = runProjection(data);
        setYears(projection);
        if (projection.length > 0) {
          setYearRange([projection[0].year, projection[projection.length - 1].year]);
        }
        // Surface client's retirement year for the slider's preset highlighter.
        // ClientData.client carries `dateOfBirth` (YYYY-MM-DD) and `retirementAge`
        // — same pattern as cashflow-report.tsx / income-tax-report.tsx.
        const client = (data as { client?: { dateOfBirth?: string | null; retirementAge?: number | null } }).client;
        if (client?.dateOfBirth && client.retirementAge) {
          setClientRetirementYear(parseInt(client.dateOfBirth.slice(0, 4), 10) + client.retirementAge);
        } else {
          setClientRetirementYear(null);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load projection data");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [clientId, searchParams]);

  const selected = useMemo<SelectedRows>(() => {
    if (!yearRange) return { kind: "empty", rows: [] };
    return selectEntityRows({
      years,
      entityId: selectedEntityId,
      startYear: yearRange[0],
      endYear: yearRange[1],
    });
  }, [years, selectedEntityId, yearRange]);

  const onExportPdf = async () => {
    setExporting(true);
    try {
      const [{ pdf }, { default: Document }] = await Promise.all([
        import("@react-pdf/renderer"),
        import("./entities-cashflow-report-pdf/document"),
      ]);
      const entityName = entities.find((e) => e.id === selectedEntityId)?.name ?? "Entity";
      const blob = await pdf(<Document selected={selected} entityName={entityName} />).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `entities-cashflow-${selectedEntityId}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  if (loading) return <div className="p-6 text-sm text-gray-400">Loading…</div>;
  if (error) return <div className="p-6 text-sm text-red-400">Error: {error}</div>;
  if (entities.length === 0) {
    return <div className="p-6 text-sm text-gray-400">No trusts or businesses on file.</div>;
  }

  const currentYear = new Date().getFullYear();
  const minYear = years[0]?.year ?? currentYear;
  const maxYear = years[years.length - 1]?.year ?? currentYear;

  return (
    <div className="flex flex-col gap-0">
      <HeaderControls
        entities={entities}
        selectedEntityId={selectedEntityId}
        onSelectEntity={setSelectedEntityId}
        yearRange={yearRange ?? [minYear, maxYear]}
        minYear={minYear}
        maxYear={maxYear}
        clientRetirementYear={clientRetirementYear}
        onYearRangeChange={setYearRange}
        exporting={exporting}
        onExportPdf={onExportPdf}
      />
      <div className="p-4">
        {selected.kind === "trust" && <TrustTable rows={selected.rows} currentYear={currentYear} />}
        {selected.kind === "business" && <BusinessTable rows={selected.rows} currentYear={currentYear} />}
        {selected.kind === "empty" && (
          <div className="text-sm text-gray-400">No activity for this entity in the selected year range.</div>
        )}
      </div>
    </div>
  );
}
