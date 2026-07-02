// Framework-free types for the Client Profile presentation page.
import type { ClientData, ProjectionYear } from "@/engine/types";

// No per-instance configuration — the only control is the shared scenario
// picker (supportsScenarioOverride). Empty object keeps the registry plumbing
// (defaultOptions / optionsSchema / summarizeOptions) uniform with other pages.
export type ClientProfilePageOptions = Record<string, never>;
export const CLIENT_PROFILE_PAGE_OPTIONS_DEFAULT: ClientProfilePageOptions = {};

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

export interface ProfileExpenseRow {
  label: string;
  current: number;
  retirement: number;
  isTotal: boolean;
}

export interface ClientProfilePageData {
  title: string;
  subtitle: string; // scenarioLabel
  persons: ProfilePersonCard[]; // 1 (single) or 2 (couple)
  children: ProfileChildCard[];
  income: ProfileIncomeRow[];
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
}
