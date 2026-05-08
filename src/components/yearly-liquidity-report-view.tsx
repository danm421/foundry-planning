"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { Chart as ChartJSType } from "chart.js";
import {
  runProjectionWithEvents,
  type ProjectionResult,
} from "@/engine/projection";
import type { ClientData } from "@/engine/types";
import { buildYearlyLiquidityReport } from "@/lib/estate/yearly-liquidity-report";
import { YearlyLiquidityTable } from "./yearly-liquidity-table";
import { YearlyLiquidityChart } from "./yearly-liquidity-chart";
import type { OwnerDobs } from "./report-controls/age-helpers";

interface Props {
  clientId: string;
  isMarried: boolean;
  ownerNames: { clientName: string; spouseName: string | null };
  ownerDobs: OwnerDobs;
}

export default function YearlyLiquidityReportView({
  clientId,
  ownerNames,
  ownerDobs,
}: Props) {
  const searchParams = useSearchParams();
  const [projection, setProjection] = useState<ProjectionResult | null>(null);
  const [clientData, setClientData] = useState<ClientData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showPortfolio, setShowPortfolio] = useState(true);
  const [exporting, setExporting] = useState(false);
  const chartRef = useRef<ChartJSType<"bar" | "line"> | null>(null);

  async function exportPdf() {
    if (exporting) return;
    setExporting(true);
    try {
      const chartPng = chartRef.current?.canvas?.toDataURL("image/png") ?? null;
      const res = await fetch(
        `/api/clients/${clientId}/liquidity-report/export-pdf`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chartPng }),
        },
      );
      if (!res.ok) throw new Error(`PDF export failed: HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "liquidity.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
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
        const result = runProjectionWithEvents(data);
        if (cancelled) return;
        setProjection(result);
        setClientData(data);
      } catch (e) {
        if (cancelled) return;
        setLoadError(e instanceof Error ? e.message : "Failed to load projection data");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [clientId, searchParams]);

  const report = useMemo(() => {
    if (!projection || !clientData) return null;
    return buildYearlyLiquidityReport({
      projection,
      clientData,
      ownerNames,
      ownerDobs: {
        clientDob: ownerDobs.clientDob,
        spouseDob: ownerDobs.spouseDob ?? null,
      },
    });
  }, [projection, clientData, ownerNames, ownerDobs]);

  if (loadError) {
    return (
      <div className="rounded border border-red-700 bg-red-900/20 p-4 text-red-200">
        Failed to load projection: {loadError}
      </div>
    );
  }
  if (loading) {
    return <div className="text-gray-300">Loading projection…</div>;
  }
  if (!projection || !report) {
    return (
      <div className="rounded-lg border border-gray-700 bg-gray-900 p-6 text-center text-gray-300">
        No projection data available.
      </div>
    );
  }

  return (
    <div className="space-y-4 pt-4">
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setShowPortfolio((p) => !p)}
          className="rounded border border-gray-700 bg-gray-900 px-3 py-1 text-sm text-gray-200 hover:bg-gray-800"
        >
          {showPortfolio ? "Hide portfolio assets" : "Show portfolio assets"}
        </button>
        <button
          type="button"
          onClick={exportPdf}
          disabled={exporting}
          className="rounded border border-indigo-700 bg-indigo-900/30 px-3 py-1 text-sm text-indigo-200 hover:bg-indigo-900/50 disabled:opacity-50"
        >
          {exporting ? "Exporting…" : "Export PDF"}
        </button>
      </div>

      <YearlyLiquidityChart
        chartRef={chartRef}
        rows={report.rows}
        showPortfolio={showPortfolio}
      />

      <YearlyLiquidityTable
        rows={report.rows}
        totals={report.totals}
        showPortfolio={showPortfolio}
      />
    </div>
  );
}
