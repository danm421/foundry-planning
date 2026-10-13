// Framework-free types for the Client Profile presentation page.
import type { ClientData, ProjectionYear } from "@/engine/types";

// One column of the expenses table: the plan's first year, the year both
// principals are retired, or a fixed number of years after the first year (for
// a household that is already retired, where "Retirement" would repeat today).
export type ExpenseColumnSpec =
  | { kind: "current" }
  | { kind: "retirement" }
  | { kind: "yearsFromNow"; years: number };

export const MAX_EXPENSE_COLUMNS = 4;
export const MAX_YEARS_FROM_NOW = 60;

export interface ClientProfilePageOptions {
  expenseColumns: ExpenseColumnSpec[];
}
export const CLIENT_PROFILE_PAGE_OPTIONS_DEFAULT: ClientProfilePageOptions = {
  expenseColumns: [{ kind: "current" }, { kind: "retirement" }],
};

/** Column heading for one expenses column. */
export function expenseColumnLabel(spec: ExpenseColumnSpec): string {
  if (spec.kind === "current") return "Current";
  if (spec.kind === "retirement") return "Retirement";
  return `In ${spec.years} ${spec.years === 1 ? "Year" : "Years"}`;
}

export interface ProfilePersonCard {
  name: string;
  dob: string | null; // ISO date, formatted by the renderer
  age: number | null;
  retirementAge: number | null;
  retirementYear: number | null;
  lifeExpectancyAge: number | null;
  lifeExpectancyYear: number | null;
}

export interface ProfileChildCard {
  name: string;
  dob: string | null; // ISO date
  age: number | null;
}

export interface ProfileIncomeRow {
  name: string;
  typeLabel: string;
  amount: number;
  /** Already paying in the first projection year. */
  active: boolean;
  startYear: number;
  /** null when the income runs through the end of the projection ("—"). */
  endYear: number | null;
}

export interface ProfileExpenseColumn {
  label: string;
  year: number;
}

export interface ProfileExpenseRow {
  label: string;
  /** One amount per `expenseColumns` entry, in the same order. */
  amounts: number[];
  isTotal: boolean;
}

export interface ClientProfilePageData {
  title: string;
  subtitle: string; // scenarioLabel
  persons: ProfilePersonCard[]; // 1 (single) or 2 (couple)
  children: ProfileChildCard[];
  income: ProfileIncomeRow[];
  /** One line per spousal benefit folded into an income row's amount, saying
   *  whose record it is drawn on and when it starts. Printed under the table. */
  incomeNotes: string[];
  expenseColumns: ProfileExpenseColumn[];
  expenses: ProfileExpenseRow[];
}

export interface BuildClientProfileInput {
  years: ProjectionYear[];
  clientData: ClientData;
  scenarioLabel: string;
  clientName: string;
  spouseName: string | null;
  /** Spouse surname from the CRM contact; appended to the spouse's person card
   *  so a different last name shows. Null when solo or unknown. */
  spouseLastName: string | null;
  expenseColumns: ExpenseColumnSpec[];
}
