"use client";

import BenchmarkSelector from "./benchmark-selector";
import AllocationDonut from "./allocation-donut";
import AllocationTable from "./allocation-table";
import type { HouseholdAllocation, DriftRow, AssetClassLite } from "@/lib/investments/allocation";
import type { AssetClassWeight } from "@/lib/investments/benchmarks";

interface Props {
  clientId: string;
  household: HouseholdAllocation;
  drift: DriftRow[];
  assetClasses: AssetClassLite[];
  modelPortfolios: { id: string; name: string }[];
  selectedBenchmarkPortfolioId: string | null;
  benchmarkWeights: AssetClassWeight[];
}

function formatDollars(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export default function InvestmentsClient({
  clientId,
  household,
  drift: _drift,
  assetClasses,
  modelPortfolios,
  selectedBenchmarkPortfolioId,
  benchmarkWeights,
}: Props) {
  const disclosureParts: string[] = [];
  if (household.excludedNonInvestableValue > 0) {
    disclosureParts.push(`$${formatDollars(household.excludedNonInvestableValue)} in business / real estate`);
  }
  if (household.unallocatedValue > 0) {
    disclosureParts.push(`$${formatDollars(household.unallocatedValue)} in accounts without an asset mix`);
  }
  const disclosure = disclosureParts.length > 0 ? `Investable assets only. Excludes ${disclosureParts.join("; ")}.` : "Investable assets only.";

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between">
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
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.1fr_1fr]">
        <section className="rounded-lg border border-gray-700 bg-gray-900 p-4">
          <h3 className="mb-3 text-sm font-semibold text-gray-300">Allocation Details</h3>
          <AllocationTable
            household={household}
            benchmarkWeights={benchmarkWeights}
            assetClasses={assetClasses}
          />
        </section>

        <section className="rounded-lg border border-gray-700 bg-gray-900 p-4">
          <AllocationDonut household={household} />
          <p className="mt-3 text-center text-xs text-gray-500">{disclosure}</p>
        </section>

        <section className="rounded-lg border border-gray-700 bg-gray-900 p-4">
          <h3 className="mb-3 text-sm font-semibold text-gray-300">Drift vs Target</h3>
          <div className="text-xs text-gray-500">
            {selectedBenchmarkPortfolioId ? "Coming in Phase 1d" : "Select a target portfolio to see drift."}
          </div>
        </section>
      </div>

      <div className="flex items-center justify-between border-t border-gray-800 pt-4">
        <div className="flex gap-2">
          <button className="rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700" disabled>
            Download PDF
          </button>
          <button className="rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700" disabled>
            Advisor Comment
          </button>
        </div>
      </div>
    </div>
  );
}
