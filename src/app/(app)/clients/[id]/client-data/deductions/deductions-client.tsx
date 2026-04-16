"use client";

import { DeductionsDerivedSummary } from "@/components/deductions-derived-summary";
import { DeductionsItemizedList } from "@/components/deductions-itemized-list";

interface DerivedRow {
  id: string;
  accountName: string;
  subType: string;
  annualAmount: number;
  owner: "client" | "spouse" | "joint";
  startYear: number;
  endYear: number;
}

interface ItemizedRow {
  id: string;
  type: "charitable_cash" | "charitable_non_cash" | "salt" | "mortgage_interest" | "other_itemized";
  name: string | null;
  owner: "client" | "spouse" | "joint";
  annualAmount: number;
  growthRate: number;
  startYear: number;
  endYear: number;
  startYearRef: string | null;
  endYearRef: string | null;
}

interface DeductionsClientProps {
  clientId: string;
  derivedRows: DerivedRow[];
  itemizedRows: ItemizedRow[];
  currentYear: number;
}

export function DeductionsClient({ clientId, derivedRows, itemizedRows, currentYear }: DeductionsClientProps) {
  return (
    <div className="space-y-6 p-6">
      <h1 className="text-2xl font-bold text-gray-100">Deductions</h1>

      <DeductionsDerivedSummary rows={derivedRows} currentYear={currentYear} />

      <DeductionsItemizedList
        clientId={clientId}
        rows={itemizedRows}
        currentYear={currentYear}
      />

      <p className="text-xs text-gray-500">
        The standard deduction inflates with the tax-inflation rate (set in Assumptions).
        Itemized deductions inflate with each row&apos;s growth rate.
      </p>
    </div>
  );
}
