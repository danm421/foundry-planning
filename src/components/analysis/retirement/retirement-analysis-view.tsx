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
import { useRouter } from "next/navigation";
import type { ClientData, ProjectionYear } from "@/engine/types";
import type { RetirementSummary } from "@/lib/analysis/derive-retirement-summary";
import type { SolverMutation, SolverSource } from "@/lib/solver/types";
import { useToast } from "@/components/toast";
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
  earliestRetirementYear,
  sliceFromRetirement,
} from "@/lib/analysis/retirement-window";
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
  const router = useRouter();
  const { showToast } = useToast();

  const [view, setView] = useState<"summary" | "probability">("summary");
  const [explored, setExplored] = useState<{
    years: ProjectionYear[];
    summary: RetirementSummary;
  } | null>(null);
  const [savingScenario, setSavingScenario] = useState(false);
  const [savingBaseFacts, setSavingBaseFacts] = useState(false);

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

  // The table + hero chart start at the earliest retirement year (the headline +
  // KPIs keep the full-plan horizon — funding is a whole-life question). The
  // explore recompute returns the full projection, so we re-slice here too.
  const retirementStart = useMemo(
    () => earliestRetirementYear(tree.client),
    [tree],
  );
  const displayYears = useMemo(
    () => sliceFromRetirement(effectiveYears, retirementStart),
    [effectiveYears, retirementStart],
  );

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

  const handleSaveScenario = useCallback(async () => {
    if (exploreMutations.length === 0) return; // guard: no edits to save
    if (savingScenario) return; // guard: already in-flight

    // Name: "Retirement Analysis — <asOfLabel>" (max 60 chars, truncate defensively)
    const rawName = `Retirement Analysis — ${asOfLabel}`;
    const name = rawName.length > 60 ? rawName.slice(0, 60) : rawName;

    setSavingScenario(true);
    try {
      const res = await fetch(
        `/api/clients/${clientId}/solver/save-scenario`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ source, mutations: exploreMutations, name }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      await res.json(); // consume body; scenarioId not used (no navigation)
      // Refresh server components so the new scenario appears in the
      // ScenarioChipRow (mirrors live-solver-workspace.tsx pattern).
      router.refresh();
      showToast({
        message: `Saved as scenario "${name}"`,
        durationMs: 6000,
      });
    } catch (err) {
      showToast({
        message: err instanceof Error ? err.message : "Failed to save scenario",
        durationMs: 6000,
      });
    } finally {
      setSavingScenario(false);
    }
  }, [exploreMutations, savingScenario, clientId, source, asOfLabel, router, showToast]);

  const handleSaveBaseFacts = useCallback(async () => {
    if (exploreMutations.length === 0) return; // guard: no edits to save
    if (savingBaseFacts) return; // guard: already in-flight

    if (
      !window.confirm(
        "This updates the client's base facts (plan of record), not a scenario. Continue?",
      )
    ) {
      return;
    }

    setSavingBaseFacts(true);
    try {
      const res = await fetch(
        `/api/clients/${clientId}/analysis/retirement/save-to-base`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ source, mutations: exploreMutations }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as {
        appliedCount: number;
        skipped: { kind: string; reason: string }[];
      };
      // Reflect the new base facts: server components reload the base tree.
      router.refresh();
      const suffix =
        data.skipped.length > 0
          ? " (retirement age changes can only be saved to a scenario)"
          : "";
      showToast({
        message: `Saved ${data.appliedCount} change${data.appliedCount === 1 ? "" : "s"} to base facts${suffix}`,
        durationMs: 6000,
      });
    } catch (err) {
      showToast({
        message: err instanceof Error ? err.message : "Failed to save base facts",
        durationMs: 6000,
      });
    } finally {
      setSavingBaseFacts(false);
    }
  }, [exploreMutations, savingBaseFacts, clientId, source, router, showToast]);

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
      <div className="flex flex-col gap-[var(--gap-grid)] p-[var(--pad-card)]">
        {/* View-specific hero */}
        {view === "summary" ? (
          <>
            <AnalysisHeadline segments={buildSummaryHeadline(effectiveSummary)} />
            <RetirementHeroChart years={displayYears} />
            <AnalysisKpiRow items={buildKpis(effectiveSummary)} />
          </>
        ) : (
          <>
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
          </>
        )}

        {/* Shared across both views */}
        <AnalysisOptionsGrid
          clientId={clientId}
          source={source}
          rows={rows}
          savingsAccountId={savingsAccountId}
          onExploreResult={onExploreResult}
          onMutationsChange={onMutationsChange}
          onSaveScenario={handleSaveScenario}
          savingScenario={savingScenario}
          onSaveBaseFacts={handleSaveBaseFacts}
          savingBaseFacts={savingBaseFacts}
        />
        <AnalysisYearTable
          rows={displayYears}
          columns={retirementYearColumns(hasSpouse)}
          caption="Year-by-year breakdown"
        />
      </div>
    </AnalysisShell>
  );
}
