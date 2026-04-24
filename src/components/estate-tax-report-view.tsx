"use client";

import { useEffect, useMemo, useState } from "react";
import { runProjection } from "@/engine/projection";
import type { ProjectionYear } from "@/engine/types";

interface EstateTaxReportViewProps {
  clientId: string;
  isMarried: boolean;
  ownerNames: { clientName: string; spouseName: string | null };
}

type Ordering = "primaryFirst" | "spouseFirst";

export default function EstateTaxReportView({
  clientId,
  isMarried,
  ownerNames,
}: EstateTaxReportViewProps) {
  const [projectionYears, setProjectionYears] = useState<ProjectionYear[]>([]);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [ordering, setOrdering] = useState<Ordering>("primaryFirst");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/clients/${clientId}/projection-data`);
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const data = await res.json();
        const projection = runProjection(data);
        if (cancelled) return;
        setProjectionYears(projection);
        if (projection.length > 0) setSelectedYear(projection[0].year);
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
  }, [clientId]);

  const selectedProjectionYear = useMemo(() => {
    if (selectedYear == null) return null;
    return projectionYears.find((y) => y.year === selectedYear) ?? null;
  }, [projectionYears, selectedYear]);

  const hypothetical = selectedProjectionYear?.hypotheticalEstateTax ?? null;

  if (loadError) {
    return (
      <div className="rounded border border-red-700 bg-red-900/20 p-4 text-red-200">
        Failed to load projection: {loadError}
      </div>
    );
  }

  if (loading || !hypothetical || selectedYear == null) {
    return <div className="text-gray-400">Loading projection…</div>;
  }

  const activeOrdering =
    ordering === "spouseFirst" && hypothetical.spouseFirst
      ? hypothetical.spouseFirst
      : hypothetical.primaryFirst;

  const firstDecedentName =
    activeOrdering.firstDecedent === "client"
      ? ownerNames.clientName
      : ownerNames.spouseName ?? "Spouse";
  const survivorName =
    activeOrdering.firstDecedent === "client"
      ? ownerNames.spouseName ?? "Spouse"
      : ownerNames.clientName;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <label className="text-xs uppercase tracking-wide text-gray-400">
            As of
          </label>
          <select
            className="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-sm text-gray-100"
            value={selectedYear}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
          >
            {projectionYears.map((y) => (
              <option key={y.year} value={y.year}>
                {y.year}
              </option>
            ))}
          </select>
        </div>
        {isMarried && (
          <div className="inline-flex rounded border border-gray-700 bg-gray-900 p-0.5 text-sm">
            <button
              type="button"
              className={
                ordering === "primaryFirst"
                  ? "rounded bg-gray-700 px-3 py-1 text-gray-100"
                  : "rounded px-3 py-1 text-gray-400 hover:text-gray-200"
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
                  : "rounded px-3 py-1 text-gray-400 hover:text-gray-200"
              }
              onClick={() => setOrdering("spouseFirst")}
            >
              {ownerNames.spouseName ?? "Spouse"} dies first
            </button>
          </div>
        )}
      </div>

      <p className="text-xs text-gray-500">
        {isMarried
          ? `Assumes both clients die in ${selectedYear}. Hypothetical only.`
          : `Assumes ${firstDecedentName} dies in ${selectedYear}. Hypothetical only.`}
      </p>

      {/* Task 9 renders the Form-706 breakdown sections + totals here. */}
      <DecedentPlaceholder
        heading={`${firstDecedentName} — ${isMarried ? "First to die" : `Hypothetical death in ${selectedYear}`}`}
      />
      {isMarried && activeOrdering.finalDeath && (
        <DecedentPlaceholder heading={`${survivorName} — Second to die`} />
      )}
    </div>
  );
}

function DecedentPlaceholder({ heading }: { heading: string }) {
  return (
    <section className="rounded border border-gray-700 bg-gray-900 p-4">
      <h2 className="text-sm font-semibold text-gray-100">{heading}</h2>
      <p className="mt-2 text-xs text-gray-500">
        Form-706 breakdown — added in Task 9.
      </p>
    </section>
  );
}
