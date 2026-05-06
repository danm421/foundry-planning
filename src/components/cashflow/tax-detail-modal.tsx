"use client";

import { useState } from "react";
import type { ProjectionYear } from "@/engine";
import {
  TAX_DETAIL_TABS,
  TaxDetailView,
  type TaxDetailTabId,
} from "./tax-detail-view";
import DialogShell from "@/components/dialog-shell";

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
  const [activeTab, setActiveTab] = useState<TaxDetailTabId>("income");

  return (
    <DialogShell
      open={true}
      onOpenChange={(open) => { if (!open) onClose(); }}
      title="Tax Detail — All Years"
      size="xl"
      tabs={TAX_DETAIL_TABS}
      activeTab={activeTab}
      onTabChange={(id) => setActiveTab(id as TaxDetailTabId)}
      secondaryAction={{ label: "Close", onClick: onClose }}
    >
      <TaxDetailView
        activeTab={activeTab}
        years={years}
        onYearClick={onYearClick}
        yearRange={yearRange}
        onYearRangeChange={onYearRangeChange}
        planStartYear={planStartYear}
        planEndYear={planEndYear}
        clientRetirementYear={clientRetirementYear}
        clientLifeExpectancy={clientLifeExpectancy}
        spouseLifeExpectancy={spouseLifeExpectancy}
      />
    </DialogShell>
  );
}
