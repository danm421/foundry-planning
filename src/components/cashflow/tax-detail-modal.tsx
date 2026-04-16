"use client";

import { useEffect, useState } from "react";
import type { ProjectionYear } from "@/engine";
import { TaxDetailIncomeTable } from "./tax-detail-income-table";
import { TaxDetailFlowTable } from "./tax-detail-flow-table";
import { YearRangeSlider } from "./year-range-slider";

type Tab = "income" | "federal";

interface TaxDetailModalProps {
  years: ProjectionYear[];
  onClose: () => void;
  onYearClick: (year: ProjectionYear) => void;
  // Year-range slider — shared with the cashflow page so changes flow both ways
  yearRange: [number, number];
  onYearRangeChange: (next: [number, number]) => void;
  planStartYear: number;
  planEndYear: number;
  clientRetirementYear: number | null;
}

export function TaxDetailModal({
  years,
  onClose,
  onYearClick,
  yearRange,
  onYearRangeChange,
  planStartYear,
  planEndYear,
  clientRetirementYear,
}: TaxDetailModalProps) {
  const [activeTab, setActiveTab] = useState<Tab>("income");

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="flex h-[90vh] w-[90vw] max-w-[1600px] flex-col overflow-hidden rounded-xl border border-gray-700 bg-gray-900 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with tabs */}
        <div className="flex items-start justify-between border-b border-gray-800 px-6 pt-4">
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-gray-100">Tax Detail — All Years</h2>
            <p className="mt-1 text-xs text-gray-500">
              Hover column headers for explanations. Click a year to see that year&apos;s per-source breakdown.
            </p>
            <nav className="mt-4 flex gap-1 border-b border-transparent" role="tablist">
              <TabButton
                active={activeTab === "income"}
                onClick={() => setActiveTab("income")}
              >
                Income Breakdown
              </TabButton>
              <TabButton
                active={activeTab === "federal"}
                onClick={() => setActiveTab("federal")}
              >
                Federal Tax Breakdown
              </TabButton>
            </nav>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="-mr-2 text-xl text-gray-400 hover:text-gray-200"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-6">
          <div className="mb-4">
            <YearRangeSlider
              min={planStartYear}
              max={planEndYear}
              value={yearRange}
              onChange={onYearRangeChange}
              clientRetirementYear={clientRetirementYear}
            />
          </div>

          {activeTab === "income" ? (
            <TaxDetailIncomeTable years={years} onYearClick={onYearClick} />
          ) : (
            <TaxDetailFlowTable years={years} onYearClick={onYearClick} />
          )}
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
        active
          ? "border-blue-500 text-gray-100"
          : "border-transparent text-gray-400 hover:text-gray-200"
      }`}
    >
      {children}
    </button>
  );
}
