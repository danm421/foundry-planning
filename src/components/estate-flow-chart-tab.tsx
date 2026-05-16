"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import { AsOfDropdown, type AsOfValue } from "./report-controls/as-of-dropdown";
import { DeathOrderToggle } from "./report-controls/death-order-toggle";
import { EstateFlowSankey } from "./estate-flow-sankey";
import {
  buildEstateTransferReportData,
  type AsOfSelection,
} from "@/lib/estate/transfer-report";
import {
  buildEstateFlowGraph,
  layoutEstateFlowGraph,
} from "@/lib/estate/estate-flow-sankey";
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

const CHART_HEIGHT = 520;

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
  const [width, setWidth] = useState(900);
  const containerRef = useRef<HTMLDivElement>(null);

  // Track container width via ResizeObserver.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const w = entry.contentRect.width;
      if (w > 0) setWidth(w);
    });
    observer.observe(el);
    // Seed with the current layout width immediately.
    const initialWidth = el.clientWidth;
    if (initialWidth > 0) setWidth(initialWidth);
    return () => observer.disconnect();
  }, []);

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

  const graph = useMemo(
    () =>
      buildEstateFlowGraph({
        reportData,
        clientData: engineData,
        gifts: workingGifts,
        ownerNames,
      }),
    [reportData, engineData, workingGifts, ownerNames],
  );

  const layout = useMemo(
    () => layoutEstateFlowGraph(graph, { width, height: CHART_HEIGHT }),
    [graph, width],
  );

  // Derive years list and todayYear from the projection.
  const projectionYears = useMemo(
    () => projection.years.map((y) => y.year),
    [projection.years],
  );
  const todayYear = projectionYears[0] ?? new Date().getFullYear();

  // Death years from the projection's firstDeathEvent / secondDeathEvent.
  const firstDeathYear = projection.firstDeathEvent?.year;
  const secondDeathYear = projection.secondDeathEvent?.year;

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

  // Stage headers — 3-tuple required by EstateFlowSankey.
  // Middle entry is "" for single filers; renderer skips empty headers.
  const stageHeaders: [string, string, string] = [
    "Owners",
    isMarried ? "Surviving Spouse" : "",
    "Inherited",
  ];

  if (reportData.isEmpty) {
    return (
      <div
        ref={containerRef}
        className="py-16 text-center text-sm text-gray-500"
      >
        No estate flow to show for this selection.
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex flex-col gap-4">
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
      <EstateFlowSankey layout={layout} stageHeaders={stageHeaders} />
    </div>
  );
}
