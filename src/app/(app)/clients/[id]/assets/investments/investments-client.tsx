"use client";

import { useCallback, useRef, useState } from "react";
import CommentDialog from "./comment-dialog";
import BenchmarkSelector from "./benchmark-selector";
import AllocationDonut from "./allocation-donut";
import AllocationTable from "./allocation-table";
import AllocationTypeDrill from "./allocation-type-drill";
import AllocationDrillTable from "./allocation-drill-table";
import { TYPE_DRILL_PREFIX } from "./allocation-table";
import { isAssetTypeId, type AssetTypeId } from "@/lib/investments/asset-types";
import DriftChart from "./drift-chart";
import type { HouseholdAllocation, DriftRow, AssetClassLite } from "@/lib/investments/allocation";
import type { AssetClassWeight } from "@/lib/investments/benchmarks";
import type { HoldingClassContribution } from "@/lib/investments/holdings-rollup";
import type { AccountHoldingsGroup } from "@/lib/investments/holdings-inventory";
import { colorForAssetClass, UNALLOCATED_COLOR } from "@/lib/investments/palette";
import { ExportButton } from "@/components/exports/export-button";
import { useChartCapture } from "@/lib/report-artifacts/chart-capture";
import "@/lib/report-artifacts/index";
import AccountGroupPillBar from "@/components/account-groups/account-group-pill-bar";
import PortfolioAnalysisClient from "./portfolio-analysis-client";
import type { AnalysisRow } from "@/lib/investments/portfolio-analysis";
import { RebalanceClient } from "./rebalance-client";
import HoldingsTab from "./holdings-tab";

interface Props {
  clientId: string;
  household: HouseholdAllocation;
  householdAll: HouseholdAllocation;
  drift: DriftRow[];
  driftAll: DriftRow[];
  assetClasses: AssetClassLite[];
  modelPortfolios: { id: string; name: string }[];
  selectedBenchmarkPortfolioId: string | null;
  benchmarkWeights: AssetClassWeight[];
  existingCommentBody: string;
  selectedGroupKey: string;
  selectedGroupIsDefault: boolean;
  customGroups: Array<{ id: string; name: string; color: string | null }>;
  strippedMemberCount?: number;
  analysisRows: AnalysisRow[];
  holdingsByAccountClass: Record<string, Record<string, HoldingClassContribution[]>>;
  accountsWithHoldings: { id: string; name: string; category: string; value: number }[];
  fundPortfolios: { id: string; name: string }[];
  holdingsGroups: AccountHoldingsGroup[];
  initialView?: "allocation" | "analysis" | "rebalance" | "holdings";
}

type AllocationView = "high_level" | "detailed" | "combined";

function formatDollars(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export default function InvestmentsClient({
  clientId,
  household: householdInEstate,
  householdAll,
  drift: driftInEstate,
  driftAll,
  assetClasses,
  modelPortfolios,
  selectedBenchmarkPortfolioId,
  benchmarkWeights,
  existingCommentBody,
  selectedGroupKey,
  selectedGroupIsDefault,
  customGroups,
  strippedMemberCount,
  analysisRows,
  holdingsByAccountClass,
  accountsWithHoldings,
  fundPortfolios,
  holdingsGroups,
  initialView = "allocation",
}: Props) {
  const [pageView, setPageView] = useState<"allocation" | "analysis" | "rebalance" | "holdings">(initialView);
  const [commentOpen, setCommentOpen] = useState(false);
  const [drilledRowId, setDrilledRowId] = useState<string | null>(null);
  const [view, setView] = useState<AllocationView>("detailed");
  const [includeOutOfEstate, setIncludeOutOfEstate] = useState(false);

  const household = includeOutOfEstate ? householdAll : householdInEstate;
  const drift = includeOutOfEstate ? driftAll : driftInEstate;
  // Difference between "all" and "in-estate" totals = OOE entity-owned investable
  // dollars. Hide the toggle entirely when there are none — there's nothing to add.
  const hasOutOfEstateInvestables =
    householdAll.totalInvestableValue > householdInEstate.totalInvestableValue;

  const donutCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const handleDonutReady = useCallback((c: HTMLCanvasElement) => {
    donutCanvasRef.current = c;
  }, []);
  // dataVersion is a v1 placeholder — server-side hash agreement is deferred
  // to Plan 2. The route silently drops mismatched captures, so this still
  // works end-to-end today.
  useChartCapture(
    { reportId: "investments", chartId: "donut", dataVersion: "v1" },
    useCallback(() => donutCanvasRef.current, []),
  );

  const shouldShowDrift =
    selectedGroupIsDefault && selectedGroupKey !== "all-liquid";

  const hasComment = existingCommentBody.trim().length > 0;
  const disclosureParts: string[] = [];
  if (household.excludedNonInvestableValue > 0) {
    disclosureParts.push(`$${formatDollars(household.excludedNonInvestableValue)} in business / real estate`);
  }
  if (household.unallocatedValue > 0) {
    disclosureParts.push(`$${formatDollars(household.unallocatedValue)} in accounts without an asset mix`);
  }
  const disclosure = disclosureParts.length > 0 ? `Investable assets only. Excludes ${disclosureParts.join("; ")}.` : "Investable assets only.";

  const isUnallocatedDrill = drilledRowId === "__unallocated__";
  const drilledAssetClass = drilledRowId && !isUnallocatedDrill
    ? household.byAssetClass.find((b) => b.id === drilledRowId)
    : null;
  const benchmarkWeightForDrilled = drilledRowId && !isUnallocatedDrill
    ? benchmarkWeights.find((w) => w.assetClassId === drilledRowId)
    : undefined;

  // Parse the current drill id into one of: null | type | unallocated | class.
  const parsedTypeDrillId = drilledRowId?.startsWith(TYPE_DRILL_PREFIX)
    ? drilledRowId.slice(TYPE_DRILL_PREFIX.length)
    : null;
  const drilledTypeId: AssetTypeId | null =
    parsedTypeDrillId && isAssetTypeId(parsedTypeDrillId) ? parsedTypeDrillId : null;
  const drilledTypeRollup = drilledTypeId
    ? household.byAssetType.find((t) => t.id === drilledTypeId) ?? null
    : null;

  // If drilledRowId points to something that no longer resolves (e.g., user
  // switched view, or the underlying class/type dropped out of the rollup),
  // the fallback branch in the Allocation Details ternary below renders the
  // main AllocationTable — no explicit reset needed.

  return (
    <div className="flex flex-col gap-6">
      <div className="inline-flex rounded-md border border-hair-2 p-0.5 text-sm">
        <button
          type="button"
          onClick={() => setPageView("allocation")}
          className={pageView === "allocation" ? "rounded bg-card-2 px-3 py-1 text-ink" : "px-3 py-1 text-ink-3"}
        >
          Allocation
        </button>
        <button
          type="button"
          onClick={() => setPageView("analysis")}
          className={pageView === "analysis" ? "rounded bg-card-2 px-3 py-1 text-ink" : "px-3 py-1 text-ink-3"}
        >
          Portfolio Analysis
        </button>
        <button
          type="button"
          onClick={() => setPageView("rebalance")}
          className={pageView === "rebalance" ? "rounded bg-card-2 px-3 py-1 text-ink" : "px-3 py-1 text-ink-3"}
        >
          Rebalance
        </button>
        <button
          type="button"
          onClick={() => setPageView("holdings")}
          className={pageView === "holdings" ? "rounded bg-card-2 px-3 py-1 text-ink" : "px-3 py-1 text-ink-3"}
        >
          Holdings
        </button>
      </div>

      {pageView === "holdings" && <HoldingsTab groups={holdingsGroups} />}

      {pageView === "analysis" && (
        <PortfolioAnalysisClient clientId={clientId} analysisRows={analysisRows} />
      )}

      {pageView === "rebalance" && (
        <RebalanceClient
          clientId={clientId}
          accountsWithHoldings={accountsWithHoldings}
          fundPortfolios={fundPortfolios}
        />
      )}

      {pageView === "allocation" && (
        <>
        <header className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div>
            <nav className="mb-1 text-xs uppercase tracking-wide text-ink-3">
              Reports / Investments / Asset Allocation
            </nav>
            <h2 className="text-xl font-bold uppercase tracking-wide text-ink">
              Asset Allocation Report
            </h2>
          </div>
          <BenchmarkSelector
            clientId={clientId}
            modelPortfolios={modelPortfolios}
            selectedBenchmarkPortfolioId={selectedBenchmarkPortfolioId}
          />
        </div>
        <AccountGroupPillBar
          clientId={clientId}
          customGroups={customGroups}
          selected={selectedGroupKey}
        />
        {strippedMemberCount !== undefined && strippedMemberCount > 0 && (
          <p className="text-xs text-yellow-400">
            {strippedMemberCount} account{strippedMemberCount === 1 ? "" : "s"} in
            this group are no longer eligible (illiquid or removed). Edit the group
            in <em>Assumptions › Account Groups</em> to clean up.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <div
            role="radiogroup"
            aria-label="Allocation view"
            className="inline-flex self-start rounded-md border border-hair-2 bg-card-2/50 p-0.5 text-xs"
          >
            {(
              [
                { id: "high_level", label: "By Type" },
                { id: "detailed",   label: "By Class" },
                { id: "combined",   label: "Combined" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                role="radio"
                aria-checked={view === opt.id}
                onClick={() => {
                  setView(opt.id);
                  setDrilledRowId(null); // reset any open drill when switching modes
                }}
                className={`rounded px-3 py-1.5 font-medium transition-colors ${
                  view === opt.id
                    ? "bg-card text-ink"
                    : "text-ink-3 hover:text-ink"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {hasOutOfEstateInvestables && (
            <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-ink-2">
              <input
                type="checkbox"
                checked={includeOutOfEstate}
                onChange={(e) => {
                  setIncludeOutOfEstate(e.target.checked);
                  setDrilledRowId(null);
                }}
                className="h-3.5 w-3.5 rounded border-hair-2 bg-card-2 accent-accent"
              />
              Include out-of-estate assets
            </label>
          )}
        </div>
      </header>

      <div className={`grid grid-cols-1 gap-6 ${shouldShowDrift ? "lg:grid-cols-[1fr_1.1fr_1fr]" : "lg:grid-cols-[1fr_1.1fr]"}`}>
        <section className="rounded-lg border border-hair bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold text-ink-2">Allocation Details</h3>
          {drilledRowId === null ? (
            <AllocationTable
              household={household}
              benchmarkWeights={benchmarkWeights}
              assetClasses={assetClasses}
              onRowClick={setDrilledRowId}
              mode={view}
            />
          ) : drilledTypeRollup ? (
            <AllocationTypeDrill
              typeId={drilledTypeRollup.id}
              typeLabel={drilledTypeRollup.label}
              typeValue={drilledTypeRollup.value}
              typePctOfClassified={drilledTypeRollup.pctOfClassified}
              classes={household.contributionsByAssetType[drilledTypeRollup.id] ?? []}
              onBack={() => setDrilledRowId(null)}
            />
          ) : isUnallocatedDrill ? (
            <AllocationDrillTable
              assetClassName="Unallocated"
              assetClassColor={UNALLOCATED_COLOR}
              currentPct={0}
              targetPct={null}
              contributions={household.unallocatedContributions}
              totalInClass={household.unallocatedValue}
              onBack={() => setDrilledRowId(null)}
              isUnallocated
            />
          ) : drilledAssetClass ? (
            <AllocationDrillTable
              key={drilledAssetClass.id}
              assetClassName={drilledAssetClass.name}
              assetClassColor={colorForAssetClass({ sortOrder: drilledAssetClass.sortOrder })}
              currentPct={drilledAssetClass.pctOfClassified}
              targetPct={benchmarkWeightForDrilled ? benchmarkWeightForDrilled.weight : null}
              contributions={household.contributionsByAssetClass[drilledAssetClass.id] ?? []}
              totalInClass={drilledAssetClass.value}
              onBack={() => setDrilledRowId(null)}
              holdingsByAccount={Object.fromEntries(
                (household.contributionsByAssetClass[drilledAssetClass.id] ?? []).map((c) => [
                  c.accountId,
                  holdingsByAccountClass[c.accountId]?.[drilledAssetClass.id] ?? [],
                ]),
              )}
            />
          ) : (
            // Fallback: drilledRowId is set but doesn't match any known class,
            // type, or sentinel in the current rollup — render the top-level
            // table so the user has a way back.
            <AllocationTable
              household={household}
              benchmarkWeights={benchmarkWeights}
              assetClasses={assetClasses}
              onRowClick={setDrilledRowId}
              mode={view}
            />
          )}
        </section>

        <section className="rounded-lg border border-hair bg-card p-4">
          <AllocationDonut household={household} mode={view} onChartReady={handleDonutReady} />
          <p className="mt-3 text-center text-xs text-ink-3">{disclosure}</p>
        </section>

        {shouldShowDrift && (
          <section className="rounded-lg border border-hair bg-card p-4">
            <h3 className="mb-3 text-sm font-semibold text-ink-2">Drift vs Target</h3>
            <DriftChart drift={drift} assetClasses={assetClasses} />
          </section>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-hair pt-4">
        <div className="flex gap-2">
          <ExportButton
            reportId="investments"
            optsOverride={includeOutOfEstate ? { includeOutOfEstate: true } : undefined}
          />
          <button
            onClick={() => setCommentOpen(true)}
            className="relative rounded border border-hair-2 bg-card-2 px-3 py-1.5 text-sm text-ink-2 hover:bg-card-hover"
          >
            Advisor Comment
            {hasComment && (
              <span className="absolute -right-1 -top-1 inline-block h-2 w-2 rounded-full bg-accent" />
            )}
          </button>
        </div>
      </div>
      <CommentDialog
        open={commentOpen}
        onClose={() => setCommentOpen(false)}
        clientId={clientId}
        reportKey="investments_asset_allocation"
        initialBody={existingCommentBody}
      />
        </>
      )}
    </div>
  );
}
