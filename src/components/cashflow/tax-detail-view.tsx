"use client";

import type { ProjectionYear, ClientData } from "@/engine";
import { TaxDetailIncomeTable } from "./tax-detail-income-table";
import { TaxDetailFlowTable } from "./tax-detail-flow-table";
import { TaxDetailStateTable } from "./tax-detail-state-table";
import { TaxBracketTab } from "./tax-bracket-tab";
import { YearRangeSlider } from "./year-range-slider";
import { MedicareTab } from "./medicare/medicare-tab";
import type {
  IncomeColumnKey,
  BracketColumnKey,
} from "@/lib/tax/cell-drill/types";

export type TaxDetailTabId = "income" | "federal" | "state" | "bracket" | "medicare";

export const TAX_DETAIL_TABS: { id: TaxDetailTabId; label: string }[] = [
  { id: "income", label: "Income Breakdown" },
  { id: "federal", label: "Federal Tax Breakdown" },
  { id: "state", label: "State Tax Breakdown" },
  { id: "bracket", label: "Tax Bracket" },
  { id: "medicare", label: "Medicare & IRMAA" },
];

interface TaxDetailViewProps {
  activeTab: TaxDetailTabId;
  years: ProjectionYear[];
  onYearClick: (year: ProjectionYear) => void;
  onIncomeCellClick: (year: ProjectionYear, columnKey: IncomeColumnKey) => void;
  onBracketCellClick: (year: number, columnKey: BracketColumnKey) => void;
  yearRange: [number, number];
  onYearRangeChange: (next: [number, number]) => void;
  planStartYear: number;
  planEndYear: number;
  clientRetirementYear: number | null;
  clientLifeExpectancy?: number;
  spouseLifeExpectancy?: number | null;
  clientData?: ClientData | null;
  /** When provided, enables inline assumption controls (e.g. Medicare inflation
   *  toggle) that persist to plan settings via /api/clients/[id]/plan-settings. */
  clientId?: string;
  /** Called when the user changes a Medicare inflation control. Parent is
   *  responsible for updating clientData state, re-running the projection, and
   *  persisting via PATCH. */
  onMedicareInflationChange?: (next: { rate?: number; enabled?: boolean }) => void;
  /** Non-fatal save error from the most recent assumption persist (null = ok). */
  medicareAssumptionSaveError?: string | null;
  /** Whether all coverage rows have estimatePriorYearMagiFromProjection=true. */
  estimateMagi?: boolean;
  /** Called when the user toggles "Estimate prior-year MAGI from projection". */
  onEstimateMagiChange?: (value: boolean) => void;
  /** Opens the MedicareSetupDialog (passed to the empty-state CTA). */
  onEnableMedicare?: () => void;
}

export function TaxDetailView({
  activeTab,
  years,
  onYearClick,
  onIncomeCellClick,
  onBracketCellClick,
  yearRange,
  onYearRangeChange,
  planStartYear,
  planEndYear,
  clientRetirementYear,
  clientLifeExpectancy,
  spouseLifeExpectancy,
  clientData,
  clientId,
  onMedicareInflationChange,
  medicareAssumptionSaveError,
  estimateMagi,
  onEstimateMagiChange,
  onEnableMedicare,
}: TaxDetailViewProps) {
  return (
    <>
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

      {activeTab === "income" && (
        <TaxDetailIncomeTable
          years={years}
          onYearClick={onYearClick}
          onCellClick={onIncomeCellClick}
          clientLifeExpectancy={clientLifeExpectancy}
          spouseLifeExpectancy={spouseLifeExpectancy}
        />
      )}
      {activeTab === "federal" && (
        <TaxDetailFlowTable
          years={years}
          onYearClick={onYearClick}
          clientLifeExpectancy={clientLifeExpectancy}
          spouseLifeExpectancy={spouseLifeExpectancy}
        />
      )}
      {activeTab === "state" && (
        <TaxDetailStateTable
          years={years}
          onYearClick={onYearClick}
          clientLifeExpectancy={clientLifeExpectancy}
          spouseLifeExpectancy={spouseLifeExpectancy}
        />
      )}
      {activeTab === "bracket" && (
        <TaxBracketTab years={years} onCellClick={onBracketCellClick} />
      )}
      {activeTab === "medicare" && (
        <MedicareTab
          years={years}
          yearRange={yearRange}
          clientData={clientData}
          clientId={clientId}
          onInflationChange={onMedicareInflationChange}
          saveError={medicareAssumptionSaveError ?? null}
          estimateMagi={estimateMagi}
          onEstimateMagiChange={onEstimateMagiChange}
          onEnableMedicare={onEnableMedicare}
        />
      )}
    </>
  );
}
