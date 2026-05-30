"use client";

// Retirement Analysis orchestrator. Composes the full Summary view: headline,
// hero chart, KPI row, the "What are your Options?" solver grid + live Explore
// column, and the year-by-year table. The Explore column's recompute result
// (when the advisor edits) becomes the effective projection driving every
// other panel; otherwise the server-computed current projection is shown.
//
// The Probability view shows the Monte Carlo probability-of-success gauge.
// PoS is fetched when switching to the probability view (if not already
// fetched for the current mutations) and re-fetched (debounced 600 ms) when
// Explore edits change while on the probability view.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ClientData, ProjectionYear } from "@/engine/types";
import type { RetirementSummary } from "@/lib/analysis/derive-retirement-summary";
import type { SolverMutation, SolverSource } from "@/lib/solver/types";
import { AnalysisShell } from "@/components/analysis/analysis-shell";
import { AnalysisHeadline } from "@/components/analysis/analysis-headline";
import { AnalysisKpiRow } from "@/components/analysis/analysis-kpi-row";
import { AnalysisYearTable } from "@/components/analysis/analysis-year-table";
import { AnalysisOptionsGrid } from "@/components/analysis/analysis-options-grid";
import { RetirementHeroChart } from "./retirement-hero-chart";
import { RetirementPosGauge } from "./retirement-pos-gauge";
import { buildSummaryHeadline, buildProbabilityHeadline, buildKpis } from "./retirement-headline";
import { retirementYearColumns } from "./retirement-year-columns";
import {
  buildExploreRows,
  defaultSavingsAccountId,
  savingsColumnAccountId,
} from "./retirement-options-config";

const STEPS = [
  "Family Info",
  "Cost of Retirement",
  "Savings & Contributions",
  "Retirement Income",
  "Summary",
];

interface Props {
  clientId: string;
  source: SolverSource;
  /** Effective tree (base or scenario) — drives the Explore rows + solve target. */
  tree: ClientData;
  clientNames: string;
  asOfLabel: string;
  currentYears: ProjectionYear[];
  currentSummary: RetirementSummary;
}

export function RetirementAnalysisView({
  clientId,
  source,
  tree,
  clientNames,
  asOfLabel,
  currentYears,
  currentSummary,
}: Props) {
  const [view, setView] = useState<"summary" | "probability">("summary");
  const [explored, setExplored] = useState<{
    years: ProjectionYear[];
    summary: RetirementSummary;
  } | null>(null);

  // PoS state
  const [posRate, setPosRate] = useState<number | null>(null);
  const [posStatus, setPosStatus] = useState<"idle" | "computing" | "ready">("idle");
  // Mutations from the Explore grid, lifted so we can re-fetch PoS when they change.
  const [exploreMutations, setExploreMutations] = useState<SolverMutation[]>([]);
  // Track which mutations we last successfully fetched PoS for, so we don't
  // re-fetch on a view switch when nothing changed.
  const lastPosMutationsRef = useRef<string | null>(null);
  const posAbortRef = useRef<AbortController | null>(null);
  const posDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const effectiveYears = explored ? explored.years : currentYears;
  const effectiveSummary = explored ? explored.summary : currentSummary;

  const hasSpouse = currentYears[0]?.ages.spouse != null;

  const rows = useMemo(() => buildExploreRows(tree), [tree]);
  // The min-savings column targets the SAME account its highlighted Pre-Tax
  // Contributions row edits (one source of truth). When that row is absent the
  // body still needs a valid account so max-spending / earliest-retirement can
  // solve, so fall back to the largest retirement account; the grid renders
  // min-savings as "Not applicable" in that case (no pre-tax row to show on).
  const savingsAccountId = useMemo(
    () => savingsColumnAccountId(rows) ?? defaultSavingsAccountId(tree),
    [rows, tree],
  );

  const onExploreResult = useCallback(
    (result: { years: ProjectionYear[]; summary: RetirementSummary } | null) => {
      setExplored(result);
    },
    [],
  );

  const onMutationsChange = useCallback((mutations: SolverMutation[]) => {
    setExploreMutations(mutations);
  }, []);

  // Fetch PoS helper — aborts any in-flight request, then fires a new one.
  const fetchPos = useCallback(
    (mutations: SolverMutation[]) => {
      const key = JSON.stringify(mutations);
      if (lastPosMutationsRef.current === key) return; // already fetched for these mutations

      // Cancel in-flight request
      if (posAbortRef.current) posAbortRef.current.abort();
      const ac = new AbortController();
      posAbortRef.current = ac;

      setPosStatus("computing");
      (async () => {
        try {
          const res = await fetch(
            `/api/clients/${clientId}/analysis/retirement/pos`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ source, mutations }),
              signal: ac.signal,
            },
          );
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = (await res.json()) as { successRate: number };
          if (ac.signal.aborted) return;
          setPosRate(data.successRate);
          setPosStatus("ready");
          lastPosMutationsRef.current = key;
        } catch (err) {
          if (ac.signal.aborted) return;
          console.error("PoS fetch error:", err);
          setPosStatus("idle");
        }
      })();
    },
    [clientId, source],
  );

  // When switching to probability view: fetch immediately if needed.
  useEffect(() => {
    if (view !== "probability") return;
    fetchPos(exploreMutations);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]); // intentionally runs only when view changes; fetchPos is stable

  // When on probability view and Explore mutations change: debounced re-fetch.
  useEffect(() => {
    if (view !== "probability") return;
    if (posDebounceRef.current) clearTimeout(posDebounceRef.current);
    posDebounceRef.current = setTimeout(() => {
      fetchPos(exploreMutations);
    }, 600);
    return () => {
      if (posDebounceRef.current) clearTimeout(posDebounceRef.current);
    };
  }, [exploreMutations, view, fetchPos]);

  // Abort in-flight PoS request on unmount.
  useEffect(() => {
    return () => {
      posAbortRef.current?.abort();
      if (posDebounceRef.current) clearTimeout(posDebounceRef.current);
    };
  }, []);

  return (
    <AnalysisShell
      title="Retirement Analysis"
      asOfLabel={asOfLabel}
      clientNames={clientNames}
      steps={STEPS}
      view={view}
      onViewChange={setView}
    >
      {view === "summary" ? (
        <div className="flex flex-col gap-[var(--gap-grid)] p-[var(--pad-card)]">
          <AnalysisHeadline segments={buildSummaryHeadline(effectiveSummary)} />
          <RetirementHeroChart years={effectiveYears} />
          <AnalysisKpiRow items={buildKpis(effectiveSummary)} />
          <AnalysisOptionsGrid
            clientId={clientId}
            source={source}
            rows={rows}
            savingsAccountId={savingsAccountId}
            onExploreResult={onExploreResult}
            onMutationsChange={onMutationsChange}
          />
          <AnalysisYearTable
            rows={effectiveYears}
            columns={retirementYearColumns(hasSpouse)}
            caption="Year-by-year breakdown"
          />
        </div>
      ) : (
        <div className="flex flex-col gap-[var(--gap-grid)] p-[var(--pad-card)]">
          <AnalysisHeadline
            segments={
              posStatus === "ready" && posRate != null
                ? buildProbabilityHeadline(posRate)
                : [{ text: "Calculating your probability of success…" }]
            }
          />
          <div className="flex justify-center py-6">
            <RetirementPosGauge successRate={posRate} status={posStatus} />
          </div>
          <AnalysisOptionsGrid
            clientId={clientId}
            source={source}
            rows={rows}
            savingsAccountId={savingsAccountId}
            onExploreResult={onExploreResult}
            onMutationsChange={onMutationsChange}
          />
          <AnalysisYearTable
            rows={effectiveYears}
            columns={retirementYearColumns(hasSpouse)}
            caption="Year-by-year breakdown"
          />
        </div>
      )}
    </AnalysisShell>
  );
}
