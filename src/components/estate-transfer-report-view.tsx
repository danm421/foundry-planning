"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { runProjectionWithEvents, type ProjectionResult } from "@/engine/projection";
import { AsOfDropdown, type AsOfValue } from "./report-controls/as-of-dropdown";
import { TimePeriodButtons } from "./report-controls/time-period-buttons";
import type { OwnerDobs } from "./report-controls/age-helpers";
import {
  buildEstateTransferReportData,
  type AsOfSelection,
} from "@/lib/estate/transfer-report";
import type { ClientData } from "@/engine/types";
import { EstateTransferDeathSection } from "./estate-transfer-death-section";
import { EstateTransferRecipientTotals } from "./estate-transfer-recipient-totals";
import { EstateTransferCharts } from "./estate-transfer-charts";

interface EstateTransferReportViewProps {
  clientId: string;
  isMarried: boolean;
  ownerNames: { clientName: string; spouseName: string | null };
  ownerDobs: OwnerDobs;
  retirementYear: number;
}

type Ordering = "primaryFirst" | "spouseFirst";

export default function EstateTransferReportView({
  clientId,
  isMarried,
  ownerNames,
  ownerDobs,
  retirementYear,
}: EstateTransferReportViewProps) {
  const searchParams = useSearchParams();
  const [projection, setProjection] = useState<ProjectionResult | null>(null);
  const [clientData, setClientData] = useState<ClientData | null>(null);
  const [selectedAsOf, setSelectedAsOf] = useState<AsOfValue>("today");
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

  const projectionYears = useMemo(() => projection?.years ?? [], [projection]);
  const todayYear = projectionYears[0]?.year;
  const firstDeathYear = projection?.firstDeathEvent?.year;
  const secondDeathYear = projection?.secondDeathEvent?.year;
  const lastDeathYear = secondDeathYear ?? firstDeathYear;

  const asOfSelection: AsOfSelection = useMemo(() => {
    if (selectedAsOf === "today") return { kind: "today" };
    if (selectedAsOf === "split") return { kind: "split" };
    return { kind: "year", year: selectedAsOf };
  }, [selectedAsOf]);

  const reportData = useMemo(() => {
    if (!projection || !clientData) return null;
    return buildEstateTransferReportData({
      projection,
      asOf: asOfSelection,
      ordering,
      clientData,
      ownerNames,
    });
  }, [projection, clientData, asOfSelection, ordering, ownerNames]);

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

  if (!projection || projectionYears.length === 0 || todayYear == null) {
    return (
      <div className="rounded-lg border border-gray-700 bg-gray-900 p-6 text-center text-gray-300">
        No projection data available. Ensure plan settings and base case scenario are configured.
      </div>
    );
  }

  const milestones = [
    { year: retirementYear, label: "Retirement" },
    ...(firstDeathYear != null ? [{ year: firstDeathYear, label: "First Death" }] : []),
    ...(secondDeathYear != null ? [{ year: secondDeathYear, label: "Last Death" }] : []),
  ];
  const dropdownYears = projectionYears.map((y) => y.year);

  const isSplit = selectedAsOf === "split";

  return (
    <div className="space-y-4 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TimePeriodButtons
          selected={selectedAsOf}
          onChange={setSelectedAsOf}
          todayYear={todayYear}
          retirementYear={retirementYear}
          firstDeathYear={firstDeathYear}
          lastDeathYear={lastDeathYear}
          showSplit={isMarried && firstDeathYear != null && secondDeathYear != null}
        />
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs uppercase tracking-wide text-gray-300">
            As of
            <AsOfDropdown
              years={dropdownYears}
              todayYear={todayYear}
              selected={selectedAsOf}
              onChange={setSelectedAsOf}
              dobs={ownerDobs}
              milestones={milestones}
              allowSplit={isMarried && firstDeathYear != null && secondDeathYear != null}
              yearPrefix="Both die in"
            />
          </label>
          {isMarried && !isSplit && (
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
          )}
        </div>
      </div>

      {reportData && (
        <p className="text-xs text-gray-400">{reportData.asOfLabel}</p>
      )}

      {reportData?.isEmpty && (
        <div className="rounded-lg border border-gray-700 bg-gray-900 p-6 text-center text-gray-300">
          No transfers to display for this selection.
        </div>
      )}

      {reportData && reportData.aggregateRecipientTotals.length > 0 && (
        <EstateTransferCharts totals={reportData.aggregateRecipientTotals} />
      )}

      {reportData?.firstDeath && (
        <EstateTransferDeathSection
          heading={`${reportData.firstDeath.decedentName} — ${
            isMarried ? "First to die" : "Hypothetical death"
          } · ${reportData.firstDeath.year}`}
          section={reportData.firstDeath}
        />
      )}
      {reportData?.secondDeath && (
        <EstateTransferDeathSection
          heading={`${reportData.secondDeath.decedentName} — Second to die · ${reportData.secondDeath.year}`}
          section={reportData.secondDeath}
        />
      )}
      {reportData && reportData.aggregateRecipientTotals.length > 0 && (
        <EstateTransferRecipientTotals totals={reportData.aggregateRecipientTotals} />
      )}
    </div>
  );
}
