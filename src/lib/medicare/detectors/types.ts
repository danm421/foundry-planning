import type { ProjectionYear } from "@/engine";

export interface MedicareCallout {
  id: "rmd-era" | "survivor-shock" | "duplicate-expense";
  severity: "info" | "warning" | "alert";
  title: string;
  body: string;
  impactedYears: number[];
  totalSurchargeOverWindow?: number;
  action?: { label: string; href: string };
}

export type MedicareDetectorContext = {
  years: ProjectionYear[];
  expenses: Array<{
    id: string;
    name: string;
    annualAmount: number;
    startYear: number;
    endYear: number;
    endsAtMedicareEligibilityOwner: "client" | "spouse" | null;
  }>;
  medicareCoverage: Array<{ owner: "client" | "spouse"; enrollmentYear: number | null }>;
  rmdStartAges: { client: number; spouse?: number };
};

export type MedicareDetector = (ctx: MedicareDetectorContext) => MedicareCallout | null;
