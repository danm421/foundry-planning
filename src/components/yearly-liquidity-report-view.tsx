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
  const chartRef = useRef<ChartJSType<"bar" | "line"> | null>(null);

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
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setShowPortfolio((p) => !p)}
          className="rounded border border-gray-700 bg-gray-900 px-3 py-1 text-sm text-gray-200 hover:bg-gray-800"
        >
          {showPortfolio ? "Hide portfolio assets" : "Show portfolio assets"}
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
