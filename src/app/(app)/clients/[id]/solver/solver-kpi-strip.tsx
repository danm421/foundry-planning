"use client";

import { SolverPosGauge } from "./solver-pos-gauge";
import { SolverEndingAssetsKpi } from "./solver-ending-assets-kpi";
import { SolverYearsFundedKpi } from "./solver-years-funded-kpi";
import { SolverLifetimeTaxKpi } from "./solver-lifetime-tax-kpi";
import { SolverNetToHeirsKpi } from "./solver-net-to-heirs-kpi";

interface Props {
  posState: "idle" | "computing" | "ready" | "stale" | "error";
  workingSuccess: number | null;
  baselineSuccess: number | null;
  endingAssets: number | null;
  endingAssetsDelta: number | null;
  yearsFunded: number;
  yearsFundedDelta: number;
  lifetimeTax: number;
  lifetimeTaxDelta: number;
  netToHeirs: number | null;
  netToHeirsDelta: number | null;
  netToHeirsLoading: boolean;
  dimmed: boolean;
  onRegenerate: () => void;
  solveActive: boolean;
}

/** Consolidated scenario KPI row for the right reports pane. Deltas are vs base. */
export function SolverKpiStrip({
  posState,
  workingSuccess,
  baselineSuccess,
  endingAssets,
  endingAssetsDelta,
  yearsFunded,
  yearsFundedDelta,
  lifetimeTax,
  lifetimeTaxDelta,
  netToHeirs,
  netToHeirsDelta,
  netToHeirsLoading,
  dimmed,
  onRegenerate,
  solveActive,
}: Props) {
  return (
    <div className="flex flex-wrap items-start gap-x-6 gap-y-3 rounded-lg border border-hair bg-card-2/50 px-5 py-4">
      <SolverPosGauge
        state={posState}
        successPct={workingSuccess}
        baselineSuccessPct={baselineSuccess}
        onRegenerate={onRegenerate}
        solveActive={solveActive}
      />
      <SolverEndingAssetsKpi value={endingAssets} delta={endingAssetsDelta} dimmed={dimmed} />
      <SolverYearsFundedKpi value={yearsFunded} delta={yearsFundedDelta} dimmed={dimmed} />
      <SolverLifetimeTaxKpi value={lifetimeTax} delta={lifetimeTaxDelta} dimmed={dimmed} />
      <SolverNetToHeirsKpi
        value={netToHeirs}
        delta={netToHeirsDelta}
        dimmed={dimmed}
        loading={netToHeirsLoading}
      />
    </div>
  );
}
