"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { runProjection } from "@/engine/projection";
import type { FamilyMember, ProjectionYear } from "@/engine/types";
import type { AccountOwner } from "@/engine/ownership";
import type { OwnerDobs } from "./report-controls/age-helpers";
import HeaderControls from "./balance-sheet-report/header-controls";
import AssetsPanel from "./balance-sheet-report/assets-panel";
import LiabilitiesPanel from "./balance-sheet-report/liabilities-panel";
import CenterColumn from "./balance-sheet-report/center-column";
import EntityBreakdownPanel from "./balance-sheet-report/entity-breakdown-panel";
import { buildViewModel } from "./balance-sheet-report/view-model";
import type { OwnershipView } from "./balance-sheet-report/ownership-filter";

interface EntityInfo { id: string; name: string; entityType: string }

interface BalanceSheetReportViewProps {
  clientId: string;
  isMarried: boolean;
  ownerDobs: OwnerDobs;
  entities: EntityInfo[];
}

interface ProjectionApiResponse {
  accounts: Array<{
    id: string;
    name: string;
    category: string;
    owners: AccountOwner[];
  }>;
  liabilities: Array<{
    id: string;
    name: string;
    owners: AccountOwner[];
    linkedPropertyId?: string | null;
  }>;
  entities?: Array<{
    id: string;
    name: string;
    entityType?: string;
    isIrrevocable?: boolean;
    value?: number;
    owners?: Array<{ familyMemberId: string; percent: number }>;
  }>;
  familyMembers?: FamilyMember[];
  [key: string]: unknown;
}

export default function BalanceSheetReportView({
  clientId,
  isMarried,
  ownerDobs,
  entities,
}: BalanceSheetReportViewProps) {
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [apiData, setApiData] = useState<ProjectionApiResponse | null>(null);
  const [projectionYears, setProjectionYears] = useState<ProjectionYear[]>([]);
  const [selectedAsOf, setSelectedAsOf] = useState<"today" | number | null>(null);
  const [view, setView] = useState<OwnershipView>("consolidated");
  const [exporting, setExporting] = useState(false);

  const donutCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const barCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const scenarioParam = searchParams?.get("scenario");
        const url = scenarioParam
          ? `/api/clients/${clientId}/projection-data?scenario=${encodeURIComponent(scenarioParam)}`
          : `/api/clients/${clientId}/projection-data`;
        const res = await fetch(url);
        if (!res.ok) {
          const body = await res.json().catch(() => ({})) as { error?: string };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const data = await res.json();
        const projection = runProjection(data);
        setApiData(data);
        setProjectionYears(projection);
        if (projection.length > 0) setSelectedAsOf("today");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load projection data");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [clientId, searchParams]);

  // Pass through `owners[]` directly — the slice-based view-model handles
  // routing each owner's share to in-estate, OOE, or per-entity buckets.
  const { mappedAccounts, mappedLiabilities, hasEntityAccounts, fullEntities, mappedFamilyMembers } = useMemo(() => {
    if (!apiData) {
      return { mappedAccounts: [], mappedLiabilities: [], hasEntityAccounts: false, fullEntities: entities, mappedFamilyMembers: [] };
    }
    const accounts = apiData.accounts.map((a) => ({
      id: a.id,
      name: a.name,
      category: a.category,
      owners: a.owners ?? [],
    }));
    const liabilities = apiData.liabilities.map((l) => ({
      id: l.id,
      name: l.name,
      owners: l.owners ?? [],
      linkedPropertyId: l.linkedPropertyId ?? null,
    }));
    // Merge entity metadata from the page (id/name/entityType) with the
    // dynamic fields (value, owners, isIrrevocable) emitted by the API.
    const apiEntities = apiData.entities ?? [];
    const merged = entities.map((e) => {
      const fromApi = apiEntities.find((x) => x.id === e.id);
      return {
        id: e.id,
        name: e.name,
        entityType: e.entityType,
        isIrrevocable: fromApi?.isIrrevocable,
        value: fromApi?.value,
        owners: fromApi?.owners,
      };
    });
    return {
      mappedAccounts: accounts,
      mappedLiabilities: liabilities,
      hasEntityAccounts:
        accounts.some((a) => a.owners.some((o) => o.kind === "entity")) ||
        merged.some((e) => (e.value ?? 0) > 0),
      fullEntities: merged,
      mappedFamilyMembers: apiData.familyMembers ?? [],
    };
  }, [apiData, entities]);

  const viewModel = useMemo(() => {
    if (!apiData || selectedAsOf == null || projectionYears.length === 0) return null;
    const asOfMode = selectedAsOf === "today" ? "today" : "eoy";
    const selectedYear =
      selectedAsOf === "today" ? projectionYears[0].year : selectedAsOf;
    return buildViewModel({
      accounts: mappedAccounts,
      liabilities: mappedLiabilities,
      entities: fullEntities,
      familyMembers: mappedFamilyMembers,
      projectionYears,
      selectedYear,
      view,
      asOfMode,
    });
  }, [apiData, mappedAccounts, mappedLiabilities, fullEntities, mappedFamilyMembers, projectionYears, selectedAsOf, view]);

  async function handleExportPdf() {
    if (!viewModel || !apiData || selectedAsOf == null) return;
    setExporting(true);
    try {
      const donutPng = donutCanvasRef.current?.toDataURL("image/png") ?? null;
      const barPng = barCanvasRef.current?.toDataURL("image/png") ?? null;

      const pdfYear =
        selectedAsOf === "today" ? projectionYears[0].year : selectedAsOf;
      const asOfMode = selectedAsOf === "today" ? "today" : "eoy";

      const res = await fetch(
        `/api/clients/${clientId}/balance-sheet-report/export-pdf?year=${pdfYear}&view=${view}&asOf=${asOfMode}`,
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
      a.download = `balance-sheet-${selectedAsOf === "today" ? "today" : selectedAsOf}.pdf`;
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

  if (loading) return <div className="text-gray-300">Loading projection...</div>;
  if (error) {
    return (
      <div className="rounded-lg border border-red-800 bg-red-900/50 p-6 text-red-400">
        Error: {error}
      </div>
    );
  }
  if (!viewModel || projectionYears.length === 0 || selectedAsOf == null) {
    return (
      <div className="rounded-lg border border-gray-700 bg-gray-900 p-6 text-center text-gray-300">
        No projection data available. Ensure plan settings and base case scenario are configured.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <HeaderControls
        years={projectionYears.map((y) => y.year)}
        todayYear={projectionYears[0].year}
        ownerDobs={ownerDobs}
        selectedAsOf={selectedAsOf}
        onAsOfChange={setSelectedAsOf}
        view={view}
        onViewChange={setView}
        showViewSelector={isMarried || hasEntityAccounts}
        hasEntityAccounts={hasEntityAccounts}
        onExportPdf={handleExportPdf}
        exportInProgress={exporting}
      />

      {view === "entities" ? (
        <div className="grid gap-5 lg:grid-cols-[2fr_1.1fr]">
          <EntityBreakdownPanel viewModel={viewModel} />
          <CenterColumn
            viewModel={viewModel}
            donutCanvasRef={donutCanvasRef}
            barCanvasRef={barCanvasRef}
          />
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1fr_1.1fr_1fr]">
          <AssetsPanel
            viewModel={viewModel}
            showOwnerChips={isMarried || hasEntityAccounts}
          />
          <CenterColumn
            viewModel={viewModel}
            donutCanvasRef={donutCanvasRef}
            barCanvasRef={barCanvasRef}
          />
          <LiabilitiesPanel
            viewModel={viewModel}
            showOwnerChips={isMarried || hasEntityAccounts}
          />
        </div>
      )}
    </div>
  );
}
