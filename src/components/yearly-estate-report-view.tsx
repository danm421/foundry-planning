"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  runProjectionWithEvents,
  type ProjectionResult,
} from "@/engine/projection";
import type { ClientData } from "@/engine/types";
import {
  buildYearlyEstateReport,
  type Ordering,
} from "@/lib/estate/yearly-estate-report";
import { YearlyEstateTable } from "./yearly-estate-table";
import { YearlyEstateCharts } from "./yearly-estate-charts";
import { buildEstateTransferReportData } from "@/lib/estate/transfer-report";
import type { OwnerDobs } from "./report-controls/age-helpers";
import { buildLifeEventsByYear } from "@/lib/life-event-markers";

interface Props {
  clientId: string;
  isMarried: boolean;
  ownerNames: { clientName: string; spouseName: string | null };
  ownerDobs: OwnerDobs;
}

export default function YearlyEstateReportView({
  clientId,
  isMarried,
  ownerNames,
  ownerDobs,
}: Props) {
  const searchParams = useSearchParams();
  const [projection, setProjection] = useState<ProjectionResult | null>(null);
  const [clientData, setClientData] = useState<ClientData | null>(null);
  const [ordering, setOrdering] = useState<Ordering>("primaryFirst");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

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
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const data = (await res.json()) as ClientData;
        const result = runProjectionWithEvents(data);
        if (cancelled) return;
        setProjection(result);
        setClientData(data);
      } catch (e) {
        if (cancelled) return;
        setLoadError(
          e instanceof Error ? e.message : "Failed to load projection data",
        );
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
    return buildYearlyEstateReport({
      projection,
      clientData,
      ordering,
      ownerNames,
      ownerDobs: {
        clientDob: ownerDobs.clientDob,
        spouseDob: ownerDobs.spouseDob ?? null,
      },
    });
  }, [projection, clientData, ordering, ownerNames, ownerDobs]);

  const eventsByYear = useMemo(
    () => (clientData ? buildLifeEventsByYear(clientData.client) : undefined),
    [clientData],
  );

  const splitChartsData = useMemo(() => {
    if (!projection || !clientData) return null;
    const data = buildEstateTransferReportData({
      projection,
      asOf: { kind: "split" },
      ordering,
      clientData,
      ownerNames,
    });
    return {
      recipients: data.aggregateRecipientTotals.filter(
        (r) => r.recipientKind !== "spouse",
      ),
      firstDeathYear: data.firstDeath?.year ?? null,
      secondDeathYear: data.secondDeath?.year ?? null,
    };
  }, [projection, clientData, ordering, ownerNames]);

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
      {isMarried && (
        <div className="flex justify-end">
          <div className="inline-flex rounded border border-gray-700 bg-gray-900 p-0.5 text-sm">
            <button
              type="button"
              className={
                ordering === "primaryFirst"
                  ? "rounded bg-gray-700 px-3 py-1 text-gray-100"
                  : "rounded px-3 py-1 text-gray-300 hover:text-gray-200"
              }
              onClick={() => setOrdering("primaryFirst")}
            >
              {ownerNames.clientName} dies first
            </button>
            <button
              type="button"
              className={
                ordering === "spouseFirst"
                  ? "rounded bg-gray-700 px-3 py-1 text-gray-100"
                  : "rounded px-3 py-1 text-gray-300 hover:text-gray-200"
              }
              onClick={() => setOrdering("spouseFirst")}
            >
              {ownerNames.spouseName ?? "Spouse"} dies first
            </button>
          </div>
        </div>
      )}

      {splitChartsData && (
        <YearlyEstateCharts
          rows={report.rows}
          recipients={splitChartsData.recipients}
          firstDeathYear={splitChartsData.firstDeathYear}
          secondDeathYear={splitChartsData.secondDeathYear}
        />
      )}

      <YearlyEstateTable
        rows={report.rows}
        totals={report.totals}
        ownerNames={ownerNames}
        ordering={report.ordering}
        eventsByYear={eventsByYear}
      />
    </div>
  );
}
