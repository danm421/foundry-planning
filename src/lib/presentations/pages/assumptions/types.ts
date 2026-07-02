import type { ClientData, ProjectionYear } from "@/engine/types";
import type { InvestmentsBundle } from "@/lib/presentations/investments-bundle";
import type { AssumptionsPageOptions } from "./options-schema";

/** A single label/value line in an overview mini-table. */
export interface AssumptionRow {
  label: string;
  value: string;
}

export interface AssumptionsSection {
  heading: string;
  rows: AssumptionRow[];
}

export interface CategoryGrowthRow {
  category: string; // "Taxable", "Cash", ...
  source: string;   // "Model: X" / "Inflation" / "Custom"
  rate: string;     // formatted %, or "—"
}

export interface AccountGrowthRow {
  name: string;
  category: string;
  value: number | null; // null when showAccountValues is off
  rate: string;         // formatted %
  source: string;       // source label
}

export interface PortfolioAllocationRow {
  assetClass: string;
  weight: string;      // formatted %
  classReturn: string; // formatted %
}

export interface ReferencedPortfolio {
  name: string;
  blendedReturn: string; // formatted %
  rows: PortfolioAllocationRow[];
}

export interface CmaRow {
  assetClass: string;
  expectedReturn: string; // formatted %
  volatility: string;     // formatted %
}

export interface AssumptionsPageData {
  title: string;
  subtitle: string; // scenarioLabel
  /** Horizon, income tax, estate tax, inflation — each omitted when it has no rows. */
  overviewSections: AssumptionsSection[];
  categoryGrowth: CategoryGrowthRow[]; // [] when the bundle is unavailable
  withdrawalOrder: string[];           // account names in priority order
  stressTests: AssumptionRow[];        // [] when none active
  accounts: AccountGrowthRow[] | null; // null when includeAccountTable is off
  referencedPortfolios: ReferencedPortfolio[] | null; // null when appendix off/unavailable
  cma: CmaRow[] | null;                // null when appendix off/unavailable
  /** True when any base-case-sourced section (accounts/appendix) is shown, so the
   *  renderer prints the base-case footnote. */
  showBaseCaseFootnote: boolean;
}

export interface BuildAssumptionsInput {
  clientData: ClientData;
  years: ProjectionYear[];
  investments: InvestmentsBundle | undefined;
  scenarioLabel: string;
  options: AssumptionsPageOptions;
}
