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
  estimateMagi?: boolean;
  onEstimateMagiChange?: (value: boolean) => void;
  onEnableMedicare?: () => void;
}

export function MedicareTab({
  years,
  yearRange,
  clientData,
  clientId,
  onInflationChange,
  saveError = null,
  estimateMagi,
  onEstimateMagiChange,
  onEnableMedicare,
}: Props) {
  const [clickedYear, setClickedYear] = useState<ProjectionYear | null>(null);

  const showControls = !!(clientId && clientData && onInflationChange);
  const currentRate =
    clientData?.medicarePremiumInflationRate ?? DEFAULT_MEDICARE_PREMIUM_INFLATION_RATE;
  const currentEnabled = clientData?.medicarePremiumInflationEnabled ?? true;

  // Empty-state: no coverage rows yet → show CTA
  const coverage = clientData?.medicareCoverage ?? [];
  const hasAnySpouseYear = years.some((y) => y.ages.spouse != null);
  if (coverage.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-4 text-center">
        <p className="text-[14px] text-ink-2 max-w-sm">
          Medicare modeling is not yet configured for this client. Enable it to project Part B premiums,
          IRMAA surcharges, and Medigap costs year-by-year.
        </p>
        {onEnableMedicare && (
          <button
            type="button"
            onClick={onEnableMedicare}
            className="px-4 h-9 rounded-[var(--radius-sm)] bg-accent text-accent-on text-[13px] font-medium"
          >
            Enable Medicare modeling
          </button>
        )}
        {!onEnableMedicare && (
          <p className="text-[13px] text-ink-3">
            Open the Medicare &amp; IRMAA dialog to configure coverage.
          </p>
        )}
        {hasAnySpouseYear && (
          <p className="text-[11px] text-ink-3">
            You can set up Medicare for the client, spouse, or both.
          </p>
        )}
      </div>
    );
  }

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
      {showControls && onEstimateMagiChange && (
        <div className="flex items-center gap-2 text-[13px] text-ink-2">
          <input
            type="checkbox"
            id="medicare-estimate-magi"
            checked={estimateMagi ?? false}
            onChange={(e) => onEstimateMagiChange(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-hair text-accent focus:ring-1 focus:ring-accent"
          />
          <label htmlFor="medicare-estimate-magi" className="cursor-pointer">
            Estimate prior-year MAGI from projection
          </label>
        </div>
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
