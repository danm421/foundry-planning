"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { runProjection } from "@/engine";
import type { ClientData, ProjectionYear } from "@/engine";
import { buildTimeline } from "@/lib/timeline/build-timeline";
import { buildSeries } from "@/lib/timeline/build-series";
import type { TimelineCategory, TimelineEvent, SeriesPoint } from "@/lib/timeline/timeline-types";
import TimelineControls from "@/components/timeline/timeline-controls";
import TimelineSpine from "@/components/timeline/timeline-spine";
import { CATEGORY_HEX, CATEGORY_LEGEND_LABEL } from "@/components/timeline/timeline-category-pill";

interface Props {
  clientId: string;
}

type SparklineMode = "netWorth" | "portfolio" | "netCashFlow";

export default function TimelineReportView({ clientId }: Props) {
  const [clientData, setClientData] = useState<ClientData | null>(null);
  const [projection, setProjection] = useState<ProjectionYear[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [sparklineMode, setSparklineMode] = useState<SparklineMode>("netWorth");
  const [activeCategories, setActiveCategories] = useState<Set<TimelineCategory>>(
    new Set(["life", "income", "transaction", "portfolio", "insurance", "tax"]),
  );
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const segmentRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const registerSegmentRef = useCallback((year: number, el: HTMLDivElement | null) => {
    if (el) segmentRefs.current.set(year, el);
    else segmentRefs.current.delete(year);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/projection-data`);
        if (!res.ok) throw new Error(`projection-data: ${res.status}`);
        const data = (await res.json()) as ClientData;
        if (cancelled) return;
        const proj = runProjection(data);
        setClientData(data);
        setProjection(proj);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  const events: TimelineEvent[] = useMemo(
    () => (clientData && projection ? buildTimeline(clientData, projection) : []),
    [clientData, projection],
  );

  const series: SeriesPoint[] = useMemo(
    () => (projection ? buildSeries(projection) : []),
    [projection],
  );

  const visibleEvents = useMemo(
    () => events.filter((e) => activeCategories.has(e.category)),
    [events, activeCategories],
  );

  const primaryLabel = clientData ? clientData.client.firstName : "";
  const spouseLabel = clientData?.client.spouseName ?? null;
  const isCoupled = !!spouseLabel;

  if (error) {
    return <div className="p-6 text-sm text-red-400">Failed to load timeline: {error}</div>;
  }
  if (!clientData || !projection) {
    return <div className="p-6 text-sm text-gray-400">Loading timeline…</div>;
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-gray-100">Timeline</h1>
      <p className="mt-2 text-sm text-gray-400">
        {projection.length} years · {events.length} events
      </p>

      <div className="mt-6">
        <TimelineControls
          sparklineMode={sparklineMode}
          onSparklineModeChange={setSparklineMode}
          activeCategories={activeCategories}
          onToggleCategory={(cat) => {
            setActiveCategories((prev) => {
              const next = new Set(prev);
              if (next.has(cat)) next.delete(cat);
              else next.add(cat);
              return next;
            });
          }}
        />
      </div>

      <TimelineSpine
        projection={projection}
        visibleEvents={visibleEvents}
        series={series}
        sparklineMode={sparklineMode}
        expandedId={expandedId}
        onToggleExpand={(id) => setExpandedId((cur) => (cur === id ? null : id))}
        onHover={(_id) => { /* wired in Task 17 */ }}
        primaryLabel={primaryLabel}
        spouseLabel={spouseLabel}
        isCoupled={isCoupled}
        registerSegmentRef={registerSegmentRef}
      />

      <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-gray-800 pt-4 text-[11px] text-gray-500">
        <span>
          Sparkline:{" "}
          <span className="text-gray-300">
            {sparklineMode === "netWorth" ? "Net Worth" : sparklineMode === "portfolio" ? "Portfolio (investable)" : "Net Cash Flow"}
          </span>
        </span>
        {(["life", "income", "transaction", "portfolio", "insurance", "tax"] as const).map((c) => (
          <span key={c} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: CATEGORY_HEX[c] }} />
            {CATEGORY_LEGEND_LABEL[c]}
          </span>
        ))}
        <span className="ml-auto">Click any card to expand · Esc to close</span>
      </div>
    </div>
  );
}
