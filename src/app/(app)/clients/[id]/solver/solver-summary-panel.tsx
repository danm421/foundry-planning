"use client";
import { useMemo } from "react";
import type { ProjectionYear, ClientData } from "@/engine";
import type { SolverMutation, SolverSource } from "@/lib/solver/types";
import type { SummaryKey } from "@/components/solver/summaries/types";
import { SUMMARY_TABS, SUMMARY_REGISTRY } from "@/components/solver/summaries/registry";
import { SummarySkeleton, SummaryEmpty } from "@/components/solver/summaries/primitives";
import { useSolverSummaryData } from "./use-solver-summary-data";

interface Props {
  clientId: string;
  source: SolverSource;
  mutations: SolverMutation[];
  years: ProjectionYear[];
  workingTree: ClientData;
  clientName: string;
  spouseName: string | null;
  mcSuccessRate: number | null;
  activeSummary: SummaryKey;
  onSummaryChange: (s: SummaryKey) => void;
}

export function SolverSummaryPanel(props: Props) {
  const { activeSummary, onSummaryChange } = props;
  const { context, estateLoading, liLoading } = useSolverSummaryData({ ...props, enabled: true });
  const def = SUMMARY_REGISTRY[activeSummary];

  const loading =
    (activeSummary === "estate" && estateLoading && !context.projection?.firstDeathEvent) ||
    (activeSummary === "lifeInsurance" && liLoading && !context.lifeInsurance);

  const data = useMemo<unknown>(() => {
    if (loading) return null;
    try {
      return def.build(context);
    } catch (err) {
      console.error("[SolverSummaryPanel] summary builder threw for", activeSummary, err);
      return null;
    }
  }, [def, context, loading, activeSummary]);
  const View = def.Component;
  const buildFailed = !loading && data === null;

  return (
    <div className="flex flex-col gap-3">
      <div role="tablist" className="flex flex-wrap gap-1 border-b border-hair pb-2">
        {SUMMARY_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={activeSummary === t.key}
            onClick={() => onSummaryChange(t.key)}
            className={`rounded px-3 py-1 text-[12px] font-medium transition-colors ${
              activeSummary === t.key ? "bg-accent/20 text-ink" : "text-ink-3 hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {loading ? (
        <SummarySkeleton label="Loading…" />
      ) : buildFailed ? (
        <SummaryEmpty message="This summary is unavailable." />
      ) : (
        <View data={data} />
      )}
    </div>
  );
}
