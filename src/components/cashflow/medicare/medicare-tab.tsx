"use client";
import { useState } from "react";
import type { ProjectionYear, ClientData } from "@/engine";
import { DEFAULT_MEDICARE_PREMIUM_INFLATION_RATE } from "@/lib/medicare/constants";
import { MedicareMagiTierChart } from "./medicare-magi-tier-chart";
import { MedicareYearTable } from "./medicare-year-table";
import { MedicareCallouts } from "./medicare-callouts";
import { MedicareDrillDownModal } from "./medicare-drill-down-modal";
import { MedicareInflationControls } from "./medicare-inflation-controls";

interface Props {
  years: ProjectionYear[];
  yearRange: [number, number];
  clientData?: ClientData | null;
  clientId?: string;
  onInflationChange?: (next: { rate?: number; enabled?: boolean }) => void;
  saveError?: string | null;
}

export function MedicareTab({
  years,
  yearRange,
  clientData,
  clientId,
  onInflationChange,
  saveError = null,
}: Props) {
  const [clickedYear, setClickedYear] = useState<ProjectionYear | null>(null);

  const showControls = !!(clientId && clientData && onInflationChange);
  const currentRate =
    clientData?.medicarePremiumInflationRate ?? DEFAULT_MEDICARE_PREMIUM_INFLATION_RATE;
  const currentEnabled = clientData?.medicarePremiumInflationEnabled ?? true;

  return (
    <div className="flex flex-col gap-4">
      {clientData && <MedicareCallouts years={years} clientData={clientData} />}
      <MedicareMagiTierChart years={years} yearRange={yearRange} />
      {showControls && (
        <MedicareInflationControls
          rate={currentRate}
          enabled={currentEnabled}
          onChange={onInflationChange!}
          saveError={saveError}
        />
      )}
      <MedicareYearTable years={years} yearRange={yearRange} onRowClick={setClickedYear} />
      <p className="text-[11px] text-ink-3">
        * Cold-start: prior-year MAGI not yet projected; uses entered prior-year value or
        year-0 MAGI proxy.
      </p>
      <p className="text-[11px] text-ink-3">
        Medicare premium and IRMAA projections use CMS-published current-year amounts inflated
        forward at the configured rate. IRMAA thresholds are CPI-indexed. Surcharges in any
        given year reflect MAGI from two years prior. Projections do not include possible IRMAA
        appeals (life-changing events), Medicaid interactions, or specific Part D plan formulary
        effects. Actual costs will vary based on chosen plans and CMS rule changes.
      </p>
      <MedicareDrillDownModal year={clickedYear} onClose={() => setClickedYear(null)} />
    </div>
  );
}
