"use client";

import {
  DeductionsDerivedSummary,
  type DerivedRow,
  type ExpenseDeductionRow,
  type MortgageInterestRow,
  type PropertyTaxRow,
} from "@/components/deductions-derived-summary";
import { DeductionsItemizedList } from "@/components/deductions-itemized-list";
import type { ClientMilestones } from "@/lib/milestones";

interface ItemizedRow {
  id: string;
  type: "charitable" | "above_line" | "below_line" | "property_tax";
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
  expenseDeductionRows: ExpenseDeductionRow[];
  mortgageRows: MortgageInterestRow[];
  propertyTaxRows: PropertyTaxRow[];
  itemizedRows: ItemizedRow[];
  currentYear: number;
  saltCap: number;
  milestones?: ClientMilestones;
  clientFirstName?: string;
  spouseFirstName?: string;
}

export function DeductionsClient({
  clientId,
  derivedRows,
  expenseDeductionRows,
  mortgageRows,
  propertyTaxRows,
  itemizedRows,
  currentYear,
  saltCap,
  milestones,
  clientFirstName,
  spouseFirstName,
}: DeductionsClientProps) {
  return (
    <div className="space-y-6">
      <DeductionsDerivedSummary
        savingsRows={derivedRows}
        expenseRows={expenseDeductionRows}
        mortgageRows={mortgageRows}
        propertyTaxRows={propertyTaxRows}
        currentYear={currentYear}
        saltCap={saltCap}
      />

      <DeductionsItemizedList
        clientId={clientId}
        rows={itemizedRows}
        currentYear={currentYear}
        milestones={milestones}
        clientFirstName={clientFirstName}
        spouseFirstName={spouseFirstName}
      />

      <p className="text-xs text-gray-500">
        The standard deduction inflates with the tax-inflation rate (set in Assumptions).
        Itemized deductions inflate with each row&apos;s growth rate.
      </p>
    </div>
  );
}
