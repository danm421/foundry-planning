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
  type EstateTransferReportData,
} from "@/lib/estate/transfer-report";
import type { ClientData } from "@/engine/types";
import { EstateTransferDeathSection } from "./estate-transfer-death-section";
import { EstateTransferRecipientTotals } from "./estate-transfer-recipient-totals";
import { DeathOrderToggle } from "@/components/report-controls/death-order-toggle";
import type { EstateColumnReady } from "./estate-compare-shell";
import { useEstateColumnReady } from "@/hooks/use-estate-column-ready";
import { diffTransferReport } from "@/lib/estate/diff-transfer-report";
import { BASE_REF, readCompareSelection } from "@/lib/estate/compare-ref";
import EstateTransferSkeleton from "@/app/(app)/clients/[id]/estate-planning/estate-transfer/loading-skeleton";

type Ordering = "primaryFirst" | "spouseFirst";

interface EstateTransferReportViewProps {
  clientId: string;
  isMarried: boolean;
  ownerNames: { clientName: string; spouseName: string | null };
  ownerDobs: OwnerDobs;
  retirementYear: number;

  // ── Compare mode (EstateCompareShell) ──
  // All optional: with none supplied the view behaves exactly as it did before
  // the shell existed. Supplying `asOf` is what hands the controls to the shell.
  /** Overrides `?scenario=`; the right column needs its own ref. */
  scenarioRef?: string;
  asOf?: AsOfValue;
  ordering?: Ordering;
  /** Reports this column's projection metadata and report data upward. */
  onReady?: (ready: EstateColumnReady<EstateTransferReportData>) => void;
  /** The other column's report data; its presence switches on deltas. */
  baseline?: EstateTransferReportData | null;
}

export default function EstateTransferReportView({
  clientId,
  isMarried,
  ownerNames,
  ownerDobs,
  retirementYear,
  scenarioRef,
  asOf,
  ordering: orderingProp,
  onReady,
  baseline = null,
}: EstateTransferReportViewProps) {
  const searchParams = useSearchParams();
  const [projection, setProjection] = useState<ProjectionResult | null>(null);
  const [clientData, setClientData] = useState<ClientData | null>(null);
  const [ownAsOf, setOwnAsOf] = useState<AsOfValue>("today");
  const [ownOrdering, setOwnOrdering] = useState<Ordering>("primaryFirst");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const selectedAsOf = asOf ?? ownAsOf;
  const ordering = orderingProp ?? ownOrdering;
  /** The shell renders one control row for both columns; a column renders none. */
  const showOwnControls = asOf === undefined;

  // The shell supplies its column's ref; standalone, the URL's left ref is read
  // by the same helper the shell uses, so "what an absent `?scenario=` means"
  // has exactly one definition.
  const resolvedScenarioRef =
    scenarioRef ?? readCompareSelection(searchParams).left;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const url =
          resolvedScenarioRef === BASE_REF
            ? `/api/clients/${clientId}/projection-data`
            : `/api/clients/${clientId}/projection-data?scenario=${encodeURIComponent(resolvedScenarioRef)}`;
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
    // Keyed on the resolved ref, never on `searchParams`: that object is fresh
    // whenever ANY param changes, so toggling `?compare=` would refetch both
    // columns against a 30/min/firm rate limit.
  }, [clientId, resolvedScenarioRef]);

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

  // Memoized, so its identity survives an unrelated re-render — the shell
  // compares a column's reported `data` by identity.
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

  useEstateColumnReady(projection, reportData, onReady);

  if (loadError) {
    return (
      <div className="rounded border border-red-700 bg-red-900/20 p-4 text-red-200">
        Failed to load projection: {loadError}
      </div>
    );
  }

  if (loading) {
    return <EstateTransferSkeleton />;
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

  // `EstateTransferReportData` carries BOTH death sections, so this report
  // compares across both deaths — not only the first, the way the two tax
  // reports do.
  const diff =
    baseline && reportData ? diffTransferReport(baseline, reportData) : null;

  // A recipient the other column has and this one does not still gets a row, at
  // $0 — otherwise "the trust stops inheriting" reads as a recipient who was
  // never there, and `removed` is unreachable in this view. Built here from the
  // baseline the view already holds, so the table's prop contract is unchanged.
  const recipientTotals = [
    ...(reportData?.aggregateRecipientTotals ?? []),
    ...(baseline?.aggregateRecipientTotals ?? [])
      .filter(
        (t) => diff?.aggregateRecipientTotals.get(t.key)?.status === "removed",
      )
      .map((t) => ({ ...t, fromFirstDeath: 0, fromSecondDeath: 0, total: 0 })),
  ];

  return (
    <div className="space-y-4 pt-4">
      {showOwnControls && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TimePeriodButtons
            selected={selectedAsOf}
            onChange={setOwnAsOf}
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
                onChange={setOwnAsOf}
                dobs={ownerDobs}
                milestones={milestones}
                allowSplit={isMarried && firstDeathYear != null && secondDeathYear != null}
                yearPrefix="Both die in"
              />
            </label>
            {isMarried && !isSplit && (
              <DeathOrderToggle
                value={ordering}
                onChange={setOwnOrdering}
                ownerNames={ownerNames}
              />
            )}
          </div>
        </div>
      )}

      {reportData && (
        <p className="text-xs text-gray-400">{reportData.asOfLabel}</p>
      )}

      {reportData?.isEmpty && (
        <div className="rounded-lg border border-gray-700 bg-gray-900 p-6 text-center text-gray-300">
          No transfers to display for this selection.
        </div>
      )}

      {reportData?.firstDeath && (
        <EstateTransferDeathSection
          heading={`${reportData.firstDeath.decedentName} — ${
            isMarried ? "First to die" : "Hypothetical death"
          } · ${reportData.firstDeath.year}`}
          section={reportData.firstDeath}
          diff={diff?.firstDeath}
        />
      )}
      {reportData?.secondDeath && (
        <EstateTransferDeathSection
          heading={`${reportData.secondDeath.decedentName} — Second to die · ${reportData.secondDeath.year}`}
          section={reportData.secondDeath}
          diff={diff?.secondDeath}
        />
      )}
      {recipientTotals.length > 0 && (
        <EstateTransferRecipientTotals
          totals={recipientTotals}
          diff={diff?.aggregateRecipientTotals}
        />
      )}
    </div>
  );
}
