"use client";

import { useEffect, useMemo, useState } from "react";
import { runProjection } from "@/engine";
import type { ClientData, ProjectionYear } from "@/engine";
import { buildTimeline } from "@/lib/timeline/build-timeline";
import { buildSeries } from "@/lib/timeline/build-series";
import type { TimelineCategory, TimelineEvent, SeriesPoint } from "@/lib/timeline/timeline-types";
import TimelineControls from "@/components/timeline/timeline-controls";

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

      {/* Placeholder debug dump — replaced by real components in later tasks. */}
      <details className="mt-4 text-xs text-gray-500">
        <summary>debug: events + series (temporary)</summary>
        <pre className="mt-2 max-h-[60vh] overflow-auto rounded bg-gray-900 p-3 text-gray-300">
          {JSON.stringify({ sparklineMode, activeCategories: [...activeCategories], expandedId, visibleEvents, series }, null, 2)}
        </pre>
      </details>
    </div>
  );
}
