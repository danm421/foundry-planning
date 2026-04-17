"use client";

import { useEffect, useState } from "react";
import { runProjection } from "@/engine/projection";
import type { ProjectionYear } from "@/engine/types";

interface BalanceSheetReportViewProps {
  clientId: string;
}

function fmt(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

export default function BalanceSheetReportView({ clientId }: BalanceSheetReportViewProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [projectionYears, setProjectionYears] = useState<ProjectionYear[]>([]);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/clients/${clientId}/projection-data`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({})) as { error?: string };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const data = await res.json();
        const projection = runProjection(data);
        setProjectionYears(projection);
        if (projection.length > 0) {
          setSelectedYear(projection[0].year);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load projection data");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [clientId]);

  if (loading) {
    return <div className="text-gray-400">Loading projection...</div>;
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-800 bg-red-900/50 p-6 text-red-400">
        Error: {error}
      </div>
    );
  }

  if (projectionYears.length === 0) {
    return (
      <div className="rounded-lg border border-gray-700 bg-gray-900 p-6 text-center text-gray-400">
        No projection data available. Ensure plan settings and base case scenario are configured.
      </div>
    );
  }

  const yearData = projectionYears.find((y) => y.year === selectedYear) ?? projectionYears[0];

  const categories: {
    label: string;
    key: keyof Pick<
      ProjectionYear["portfolioAssets"],
      "cash" | "taxable" | "retirement" | "realEstate" | "business" | "lifeInsurance"
    >;
    total: number;
  }[] = [
    { label: "Cash", key: "cash", total: yearData.portfolioAssets.cashTotal },
    { label: "Taxable", key: "taxable", total: yearData.portfolioAssets.taxableTotal },
    { label: "Retirement", key: "retirement", total: yearData.portfolioAssets.retirementTotal },
    { label: "Real Estate", key: "realEstate", total: yearData.portfolioAssets.realEstateTotal },
    { label: "Business", key: "business", total: yearData.portfolioAssets.businessTotal },
    { label: "Life Insurance", key: "lifeInsurance", total: yearData.portfolioAssets.lifeInsuranceTotal },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-100">Balance Sheet</h1>
        <select
          value={selectedYear ?? ""}
          onChange={(e) => setSelectedYear(Number(e.target.value))}
          className="rounded border border-gray-700 bg-gray-900 px-3 py-1.5 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
        >
          {projectionYears.map((y) => (
            <option key={y.year} value={y.year}>
              {y.year}
            </option>
          ))}
        </select>
      </div>

      {/* Assets section */}
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-400">
          Assets
        </h2>
        <div className="space-y-3">
          {categories
            .filter((c) => c.total > 0)
            .map((cat) => (
              <div
                key={cat.key}
                className="rounded-lg border border-gray-700 bg-gray-900 p-4"
              >
                <div className="flex items-center justify-between border-b border-gray-700 pb-2 mb-2">
                  <span className="text-sm font-medium text-gray-300">{cat.label}</span>
                  <span className="text-sm font-semibold text-gray-100">{fmt(cat.total)}</span>
                </div>
                {Object.entries(yearData.portfolioAssets[cat.key]).map(([name, value]) => (
                  <div key={name} className="flex items-center justify-between py-1">
                    <span className="text-sm text-gray-400">{name}</span>
                    <span className="text-sm text-gray-200">{fmt(value as number)}</span>
                  </div>
                ))}
              </div>
            ))}
        </div>
      </div>

      {/* Total Assets */}
      <div className="rounded-lg border border-gray-600 bg-gray-800 px-4 py-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-gray-200">Total Assets</span>
          <span className="text-sm font-bold text-gray-100">
            {fmt(yearData.portfolioAssets.total)}
          </span>
        </div>
      </div>

      {/* Net Worth */}
      <div className="rounded-lg border border-blue-800 bg-blue-900/30 px-4 py-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-blue-300">Net Worth</span>
          <span className="text-sm font-bold text-blue-300">
            {fmt(yearData.portfolioAssets.total)}
          </span>
        </div>
      </div>
    </div>
  );
}
