"use client";

import { useState } from "react";
import type { ProjectionYear } from "@/engine";
import { TaxDetailIncomeTable } from "./tax-detail-income-table";
import { TaxDetailFlowTable } from "./tax-detail-flow-table";
import { YearRangeSlider } from "./year-range-slider";
import DialogShell from "@/components/dialog-shell";

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
  clientLifeExpectancy?: number;
  spouseLifeExpectancy?: number | null;
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
  clientLifeExpectancy,
  spouseLifeExpectancy,
}: TaxDetailModalProps) {
  const [activeTab, setActiveTab] = useState<Tab>("income");

  return (
    <DialogShell
      open={true}
      onOpenChange={(open) => { if (!open) onClose(); }}
      title="Tax Detail — All Years"
      size="xl"
      tabs={[
        { id: "income", label: "Income Breakdown" },
        { id: "federal", label: "Federal Tax Breakdown" },
      ]}
      activeTab={activeTab}
      onTabChange={(id) => setActiveTab(id as Tab)}
      secondaryAction={{ label: "Close", onClick: onClose }}
    >
      <p className="text-[12px] text-ink-3 mb-4">
        Hover column headers for explanations. Click a year to see that year&apos;s per-source breakdown.
      </p>

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
        <TaxDetailIncomeTable
          years={years}
          onYearClick={onYearClick}
          clientLifeExpectancy={clientLifeExpectancy}
          spouseLifeExpectancy={spouseLifeExpectancy}
        />
      ) : (
        <TaxDetailFlowTable
          years={years}
          onYearClick={onYearClick}
          clientLifeExpectancy={clientLifeExpectancy}
          spouseLifeExpectancy={spouseLifeExpectancy}
        />
      )}
    </DialogShell>
  );
}
