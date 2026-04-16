"use client";

import { useEffect } from "react";
import type { ProjectionYear } from "@/engine";
import { TaxDetailIncomeTable } from "./tax-detail-income-table";
import { TaxDetailFlowTable } from "./tax-detail-flow-table";

interface TaxDetailModalProps {
  years: ProjectionYear[];
  onClose: () => void;
  onYearClick: (year: ProjectionYear) => void;
}

export function TaxDetailModal({ years, onClose, onYearClick }: TaxDetailModalProps) {
  // Close on ESC
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
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-800 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-100">Tax Detail — All Years</h2>
            <p className="mt-1 text-xs text-gray-500">
              Hover column headers for explanations. Click a year to see that year&apos;s per-source breakdown.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-xl text-gray-400 hover:text-gray-200"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-6 overflow-auto p-6">
          <section>
            <h3 className="mb-3 text-sm font-semibold text-gray-300">Income Breakdown</h3>
            <TaxDetailIncomeTable years={years} onYearClick={onYearClick} />
          </section>

          <section>
            <h3 className="mb-3 text-sm font-semibold text-gray-300">Tax Calculation Flow</h3>
            <TaxDetailFlowTable years={years} onYearClick={onYearClick} />
          </section>
        </div>
      </div>
    </div>
  );
}
