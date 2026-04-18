"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { runProjection } from "@/engine/projection";
import type { ProjectionYear } from "@/engine/types";
import type { OwnerNames } from "@/lib/owner-labels";
import HeaderControls from "./balance-sheet-report/header-controls";
import AssetsPanel from "./balance-sheet-report/assets-panel";
import LiabilitiesPanel from "./balance-sheet-report/liabilities-panel";
import CenterColumn from "./balance-sheet-report/center-column";
import { buildViewModel } from "./balance-sheet-report/view-model";
import type { OwnershipView } from "./balance-sheet-report/ownership-filter";

interface EntityLabel { id: string; name: string }

interface BalanceSheetReportViewProps {
  clientId: string;
  isMarried: boolean;
  ownerNames: OwnerNames;
  entityLabels: EntityLabel[];
}

interface ProjectionApiResponse {
  accounts: Array<{ id: string; name: string; category: string; owner: "client" | "spouse" | "joint"; ownerEntityId?: string | null }>;
  liabilities: Array<{ id: string; name: string; owner?: "client" | "spouse" | "joint" | null; ownerEntityId?: string | null; linkedPropertyId?: string | null }>;
  [key: string]: unknown;
}

export default function BalanceSheetReportView({
  clientId,
  isMarried,
  ownerNames,
  entityLabels,
}: BalanceSheetReportViewProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [apiData, setApiData] = useState<ProjectionApiResponse | null>(null);
  const [projectionYears, setProjectionYears] = useState<ProjectionYear[]>([]);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [view, setView] = useState<OwnershipView>("consolidated");
  const [exporting, setExporting] = useState(false);

  const donutCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const barCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/clients/${clientId}/projection-data`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({})) as { error?: string };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const data = await res.json();
        const projection = runProjection(data);
        setApiData(data);
        setProjectionYears(projection);
        if (projection.length > 0) setSelectedYear(projection[0].year);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load projection data");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [clientId]);

  const hasEntityAccounts = useMemo(() => {
    return apiData?.accounts?.some((a) => a.ownerEntityId != null) ?? false;
  }, [apiData]);

  const entityLabelById = useMemo(() => {
    return new Map(entityLabels.map((e) => [e.id, e.name]));
  }, [entityLabels]);

  const viewModel = useMemo(() => {
    if (!apiData || selectedYear == null || projectionYears.length === 0) return null;
    return buildViewModel({
      accounts: apiData.accounts,
      liabilities: apiData.liabilities,
      projectionYears,
      selectedYear,
      view,
    });
  }, [apiData, projectionYears, selectedYear, view]);

  async function handleExportPdf() {
    if (!viewModel || !apiData || selectedYear == null) return;
    setExporting(true);
    try {
      const donutPng = donutCanvasRef.current?.toDataURL("image/png") ?? null;
      const barPng = barCanvasRef.current?.toDataURL("image/png") ?? null;

      const res = await fetch(
        `/api/clients/${clientId}/balance-sheet-report/export-pdf?year=${selectedYear}&view=${view}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ donutPng, barPng }),
        },
      );
      if (!res.ok) throw new Error(`Export failed: HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `balance-sheet-${selectedYear}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(e instanceof Error ? e.message : "PDF export failed");
    } finally {
      setExporting(false);
    }
  }

  if (loading) return <div className="text-gray-400">Loading projection...</div>;
  if (error) {
    return (
      <div className="rounded-lg border border-red-800 bg-red-900/50 p-6 text-red-400">
        Error: {error}
      </div>
    );
  }
  if (!viewModel || projectionYears.length === 0 || selectedYear == null) {
    return (
      <div className="rounded-lg border border-gray-700 bg-gray-900 p-6 text-center text-gray-400">
        No projection data available. Ensure plan settings and base case scenario are configured.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <HeaderControls
        years={projectionYears.map((y) => y.year)}
        selectedYear={selectedYear}
        onYearChange={setSelectedYear}
        view={view}
        onViewChange={setView}
        showViewSelector={isMarried || hasEntityAccounts}
        hasEntityAccounts={hasEntityAccounts}
        onExportPdf={handleExportPdf}
        exportInProgress={exporting}
      />

      <div className="grid gap-5 lg:grid-cols-[1fr_1.1fr_1fr]">
        <AssetsPanel
          viewModel={viewModel}
          view={view}
          ownerNames={ownerNames}
          showOwnerChips={isMarried || hasEntityAccounts}
          entityLabelById={entityLabelById}
        />
        <CenterColumn
          viewModel={viewModel}
          donutCanvasRef={donutCanvasRef}
          barCanvasRef={barCanvasRef}
        />
        <LiabilitiesPanel
          viewModel={viewModel}
          ownerNames={ownerNames}
          showOwnerChips={isMarried || hasEntityAccounts}
          entityLabelById={entityLabelById}
        />
      </div>
    </div>
  );
}
