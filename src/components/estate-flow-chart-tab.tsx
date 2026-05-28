"use client";

import { useMemo, useState } from "react";
import { AsOfDropdown, type AsOfValue } from "./report-controls/as-of-dropdown";
import { DeathOrderToggle } from "./report-controls/death-order-toggle";
import { EstateFlowSummaryView } from "./estate-flow-summary";
import {
  buildEstateTransferReportData,
  type AsOfSelection,
} from "@/lib/estate/transfer-report";
import { buildEstateFlowSummary } from "@/lib/estate/estate-flow-summary";
import type { ClientData } from "@/engine/types";
import type { ProjectionResult } from "@/engine/projection";
import type { EstateFlowGift } from "@/lib/estate/estate-flow-gifts";

interface Props {
  working: ClientData;
  engineData: ClientData;
  projection: ProjectionResult;
  workingGifts: EstateFlowGift[];
  isMarried: boolean;
  ownerNames: { clientName: string; spouseName: string | null };
}

export function EstateFlowChartTab({
  working,
  engineData,
  projection,
  workingGifts,
  isMarried,
  ownerNames,
}: Props) {
  const [selectedAsOf, setSelectedAsOf] = useState<AsOfValue>("today");
  const [ordering, setOrdering] = useState<"primaryFirst" | "spouseFirst">(
    "primaryFirst",
  );

  // Map AsOfValue → AsOfSelection (the real shape expected by transfer-report).
  const asOfSelection: AsOfSelection = useMemo(() => {
    if (selectedAsOf === "today") return { kind: "today" };
    if (selectedAsOf === "split") return { kind: "split" };
    return { kind: "year", year: selectedAsOf };
  }, [selectedAsOf]);

  const reportData = useMemo(
    () =>
      buildEstateTransferReportData({
        projection,
        asOf: asOfSelection,
        ordering,
        clientData: engineData,
        ownerNames,
      }),
    [projection, asOfSelection, ordering, engineData, ownerNames],
  );

  // Derive years list and todayYear from the projection.
  const projectionYears = useMemo(
    () => projection.years.map((y) => y.year),
    [projection],
  );
  const todayYear = projectionYears[0] ?? new Date().getFullYear();

  // Death years from the projection's firstDeathEvent / secondDeathEvent.
  const firstDeathYear = projection.firstDeathEvent?.year;
  const secondDeathYear = projection.secondDeathEvent?.year;

  // The OOE Irrev Trusts box needs a single concrete year (for ledger
  // balances, ownership-at-year, ILIT in-force, and cumulative-gift cutoffs).
  // In "split" mode the death-stage boxes already key off the transfer
  // report's per-death year independently, so pick the second-death year for
  // OOE — that's when heirs receive the final distribution and the OOE
  // column should mirror the end state. Fall back to first-death, then
  // today, if those events aren't available.
  const asOfYear =
    selectedAsOf === "today"
      ? todayYear
      : selectedAsOf === "split"
        ? secondDeathYear ?? firstDeathYear ?? todayYear
        : selectedAsOf;

  const summary = useMemo(
    () =>
      buildEstateFlowSummary({
        reportData,
        clientData: engineData,
        gifts: workingGifts,
        ownerNames,
        asOfYear,
        projection,
      }),
    [reportData, engineData, workingGifts, ownerNames, asOfYear, projection],
  );

  // Milestones for the AsOfDropdown.
  const milestones = useMemo(
    () => [
      ...(firstDeathYear != null
        ? [{ year: firstDeathYear, label: "First Death" }]
        : []),
      ...(secondDeathYear != null
        ? [{ year: secondDeathYear, label: "Last Death" }]
        : []),
    ],
    [firstDeathYear, secondDeathYear],
  );

  // allowSplit: married + both death years known.
  const allowSplit =
    isMarried && firstDeathYear != null && secondDeathYear != null;

  // Dobs for AsOfDropdown age annotations.
  const dobs = useMemo(
    () => ({
      clientDob: working.client.dateOfBirth,
      spouseDob: working.client.spouseDob ?? null,
    }),
    [working.client.dateOfBirth, working.client.spouseDob],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <AsOfDropdown
          years={projectionYears}
          todayYear={todayYear}
          selected={selectedAsOf}
          onChange={setSelectedAsOf}
          dobs={dobs}
          milestones={milestones}
          allowSplit={allowSplit}
          ariaLabel="Flow chart as of"
        />
        {isMarried && (
          <DeathOrderToggle
            value={ordering}
            onChange={setOrdering}
            ownerNames={ownerNames}
          />
        )}
      </div>
      <EstateFlowSummaryView summary={summary} clientName={ownerNames.clientName} />
    </div>
  );
}
