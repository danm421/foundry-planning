"use client";
import { useMemo, useState } from "react";
import { useThemeName } from "@/lib/chart-colors";
import { colors, colorsLight } from "@/brand";
import { ReportHeader } from "./report-header";
import { KpiBand } from "./kpi-band";
import { FanChart } from "./fan-chart";
import { FindingsCard } from "./findings-card";
import { RecommendationsCard } from "./recommendations-card";
import { TerminalHistogram } from "./terminal-histogram";
import { LongevityChart } from "./longevity-chart";
import { YearlyBreakdown } from "./yearly-breakdown";
import type { MonteCarloSummary, MonteCarloResult } from "@/engine";
import type { CachedMonteCarloResult } from "@/lib/compute-cache/monte-carlo";

interface MonteCarloReportViewProps {
  summary: MonteCarloSummary | null;
  raw: MonteCarloResult | null;
  deterministic: number[];
  meta: CachedMonteCarloResult["meta"] | null;
  loading: boolean;
  showHeader?: boolean;
  onReseed?: () => void;
  reseedBusy?: boolean;
  reseedError?: string | null;
}

export function MonteCarloReportView({
  summary, raw, deterministic, meta,
  showHeader = true, onReseed, reseedBusy = false, reseedError = null,
}: MonteCarloReportViewProps) {
  const theme = useThemeName();
  const brandColors = theme === "light" ? colorsLight : colors;
  const [mainChart, setMainChart] = useState<"fan" | "histogram" | "longevity">("fan");

  const ageMarkers = useMemo(() => {
    if (!meta) return [];
    const markers: Array<{ age: number; label: string; color: string }> = [
      { age: meta.retirementAge, label: `Retire ${meta.retirementAge}`, color: brandColors.cat.income },
    ];
    if (meta.spouseRetirementAge != null && meta.spouseRetirementAge !== meta.retirementAge) {
      markers.push({
        age: meta.spouseRetirementAge,
        label: `Spouse ${meta.spouseRetirementAge}`,
        color: brandColors.cat.life,
      });
    }
    return markers;
  }, [meta, brandColors]);

  const endingValues = useMemo(() => {
    if (!raw) return [];
    return raw.byYearLiquidAssetsPerTrial.map((trial) => trial.at(-1) ?? 0);
  }, [raw]);

  if (!meta) {
    return <div className="rounded-lg bg-card ring-1 ring-hair h-[440px] animate-pulse" />;
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-6">
      <div className="flex flex-col gap-6 min-w-0">
        {showHeader && (
          <ReportHeader clientDisplayName={meta.clientDisplayName} />
        )}
        {/* F16 disclosure: MC volatility/mixes are always base-case. */}
        <p className="text-[12px] text-ink-3 -mt-3">
          Monte Carlo uses base-case asset mixes and volatility.
        </p>

        {summary ? (
          <KpiBand
            summary={summary}
            startAge={summary.byYear[0]?.age?.client ?? 0}
            annualIncome={meta.annualIncomeAtStart}
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className={`rounded-lg bg-card ring-1 ring-hair p-4 min-h-[96px] animate-pulse${i === 0 ? " lg:col-span-2" : ""}`}
              />
            ))}
          </div>
        )}

        {summary && raw ? (
          <>
            {mainChart === "fan" && (
              <FanChart
                summary={summary}
                deterministic={deterministic}
                ageMarkers={ageMarkers}
                variant="main"
              />
            )}
            {mainChart === "histogram" && (
              <TerminalHistogram
                endingValues={endingValues}
                trialsRun={summary.trialsRun}
                requiredMinimumAssetLevel={meta.requiredMinimumAssetLevel}
                startingLiquidBalance={meta.startingLiquidBalance}
                variant="main"
              />
            )}
            {mainChart === "longevity" && (
              <LongevityChart
                byYearLiquidAssetsPerTrial={raw.byYearLiquidAssetsPerTrial}
                requiredMinimumAssetLevel={meta.requiredMinimumAssetLevel}
                planStartYear={meta.planStartYear}
                clientBirthYear={meta.clientBirthYear}
                variant="main"
              />
            )}
          </>
        ) : (
          <div className="rounded-lg bg-card ring-1 ring-hair h-[440px] animate-pulse" />
        )}

        {reseedError && (
          <div className="rounded border border-crit/40 bg-crit/10 p-4 text-sm text-crit">
            Couldn&apos;t generate a new seed: {reseedError}
          </div>
        )}

        {summary ? (
          <YearlyBreakdown summary={summary} />
        ) : (
          <div className="rounded-lg bg-card ring-1 ring-hair h-[320px] animate-pulse" />
        )}

        {summary && onReseed ? (
          <div className="flex justify-center pt-2">
            <button
              onClick={onReseed}
              disabled={reseedBusy}
              className="rounded-lg border border-hair bg-card px-4 py-2 text-sm text-ink-2 hover:border-good/60 hover:text-good disabled:opacity-50"
            >
              {reseedBusy ? "Generating…" : "Generate New Seed"}
            </button>
          </div>
        ) : null}
      </div>
      <aside className="flex flex-col gap-4">
        {summary && raw ? (
          <>
            <FindingsCard summary={summary} />
            {mainChart !== "fan" && (
              <FanChart
                summary={summary}
                deterministic={deterministic}
                ageMarkers={ageMarkers}
                variant="compact"
                onPromote={() => setMainChart("fan")}
              />
            )}
            {mainChart !== "histogram" && (
              <TerminalHistogram
                endingValues={endingValues}
                trialsRun={summary.trialsRun}
                requiredMinimumAssetLevel={meta.requiredMinimumAssetLevel}
                startingLiquidBalance={meta.startingLiquidBalance}
                variant="compact"
                onPromote={() => setMainChart("histogram")}
              />
            )}
            {mainChart !== "longevity" && (
              <LongevityChart
                byYearLiquidAssetsPerTrial={raw.byYearLiquidAssetsPerTrial}
                requiredMinimumAssetLevel={meta.requiredMinimumAssetLevel}
                planStartYear={meta.planStartYear}
                clientBirthYear={meta.clientBirthYear}
                variant="compact"
                onPromote={() => setMainChart("longevity")}
              />
            )}
            <RecommendationsCard />
          </>
        ) : (
          <>
            <div className="rounded-lg bg-card ring-1 ring-hair h-[120px] animate-pulse" />
            <div className="rounded-lg bg-card ring-1 ring-hair h-[260px] animate-pulse" />
            <div className="rounded-lg bg-card ring-1 ring-hair h-[280px] animate-pulse" />
            <div className="rounded-lg bg-card ring-1 ring-hair h-[140px] animate-pulse" />
          </>
        )}
      </aside>
    </div>
  );
}
