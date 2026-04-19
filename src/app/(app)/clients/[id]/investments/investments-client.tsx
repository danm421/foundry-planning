"use client";

import { useState, useEffect } from "react";
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
import { colorForAssetClass, UNALLOCATED_COLOR } from "@/lib/investments/palette";

interface Props {
  clientId: string;
  household: HouseholdAllocation;
  drift: DriftRow[];
  assetClasses: AssetClassLite[];
  modelPortfolios: { id: string; name: string }[];
  selectedBenchmarkPortfolioId: string | null;
  benchmarkWeights: AssetClassWeight[];
  existingCommentBody: string;
}

type AllocationView = "high_level" | "detailed" | "combined";

function formatDollars(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export default function InvestmentsClient({
  clientId,
  household,
  drift,
  assetClasses,
  modelPortfolios,
  selectedBenchmarkPortfolioId,
  benchmarkWeights,
  existingCommentBody,
}: Props) {
  const [commentOpen, setCommentOpen] = useState(false);
  const [drilledRowId, setDrilledRowId] = useState<string | null>(null);
  const [view, setView] = useState<AllocationView>("detailed");
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

  // If the drill id doesn't resolve (e.g., user changed view, type now has zero
  // value), clear it. Runs after render so we don't set state mid-render.
  useEffect(() => {
    if (drilledRowId === null) return;
    if (drilledRowId === "__unallocated__") return;
    if (drilledRowId.startsWith(TYPE_DRILL_PREFIX)) {
      if (!drilledTypeRollup) setDrilledRowId(null);
      return;
    }
    if (!drilledAssetClass) setDrilledRowId(null);
  }, [drilledRowId, drilledTypeRollup, drilledAssetClass]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div>
            <nav className="mb-1 text-xs uppercase tracking-wide text-gray-500">
              Reports / Investments / Asset Allocation
            </nav>
            <h2 className="text-xl font-bold uppercase tracking-wide text-gray-100">
              Asset Allocation Report
            </h2>
          </div>
          <BenchmarkSelector
            clientId={clientId}
            modelPortfolios={modelPortfolios}
            selectedBenchmarkPortfolioId={selectedBenchmarkPortfolioId}
          />
        </div>
        <div
          role="radiogroup"
          aria-label="Allocation view"
          className="inline-flex self-start rounded-md border border-gray-700 bg-gray-800/50 p-0.5 text-xs"
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
                  ? "bg-gray-700 text-white"
                  : "text-gray-400 hover:text-gray-200"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.1fr_1fr]">
        <section className="rounded-lg border border-gray-700 bg-gray-900 p-4">
          <h3 className="mb-3 text-sm font-semibold text-gray-300">Allocation Details</h3>
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
              assetClassName={drilledAssetClass.name}
              assetClassColor={colorForAssetClass({ sortOrder: drilledAssetClass.sortOrder })}
              currentPct={drilledAssetClass.pctOfClassified}
              targetPct={benchmarkWeightForDrilled ? benchmarkWeightForDrilled.weight : null}
              contributions={household.contributionsByAssetClass[drilledAssetClass.id] ?? []}
              totalInClass={drilledAssetClass.value}
              onBack={() => setDrilledRowId(null)}
            />
          ) : (
            // Fallback while the reset effect runs.
            <AllocationTable
              household={household}
              benchmarkWeights={benchmarkWeights}
              assetClasses={assetClasses}
              onRowClick={setDrilledRowId}
              mode={view}
            />
          )}
        </section>

        <section className="rounded-lg border border-gray-700 bg-gray-900 p-4">
          <AllocationDonut household={household} mode={view} />
          <p className="mt-3 text-center text-xs text-gray-500">{disclosure}</p>
        </section>

        <section className="rounded-lg border border-gray-700 bg-gray-900 p-4">
          <h3 className="mb-3 text-sm font-semibold text-gray-300">Drift vs Target</h3>
          <DriftChart drift={drift} assetClasses={assetClasses} />
        </section>
      </div>

      <div className="flex items-center justify-between border-t border-gray-800 pt-4">
        <div className="flex gap-2">
          <button
            onClick={() => {
              // TODO: real PDF export — see FUTURE_WORK.md "Plan PDF export".
              alert("PDF export is coming soon.");
            }}
            className="rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700"
          >
            Download PDF
          </button>
          <button
            onClick={() => setCommentOpen(true)}
            className="relative rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700"
          >
            Advisor Comment
            {hasComment && (
              <span className="absolute -right-1 -top-1 inline-block h-2 w-2 rounded-full bg-blue-400" />
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
    </div>
  );
}
