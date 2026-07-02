import type { AccountHoldingsGroup } from "@/lib/investments/holdings-inventory";
import type { HoldingsPageOptions } from "./options-schema";

/** One holding, pre-formatted for the PDF. Empty ticker/name render as "—". */
export interface HoldingRowVm {
  ticker: string;
  name: string;
  shares: string;      // "1,234.5678"
  price: string;       // "$123.45"
  marketValue: string; // "$12,345"
  pctOfTotal: string;  // "12.3%"
  costBasis: string | null; // null → "—"
  /** null → "—". tone drives the good/crit ink in the renderer. */
  gainLoss: { text: string; tone: "good" | "crit" | "neutral" } | null;
}

export interface AccountBlockVm {
  accountName: string;
  category: string;   // account category label, e.g. "taxable"
  totalValue: string; // "$1,234,567"
  pctOfTotal: string; // share of the whole portfolio
  rows: HoldingRowVm[];
}

export interface FlatRowVm extends HoldingRowVm {
  accountName: string;
}

export interface HoldingsPageData {
  title: string;    // "Holdings"
  subtitle: string; // "As of July 2, 2026"
  totalValue: string;
  accountCount: number;
  positionCount: number; // 0 → renderer shows the empty state
  includeCostBasis: boolean;
  /** Exactly one of the two is non-null, selected by options.groupByAccount. */
  accountBlocks: AccountBlockVm[] | null;
  flatRows: FlatRowVm[] | null;
}

export interface BuildHoldingsInput {
  /** From InvestmentsBundle.holdings — undefined when the bundle is absent. */
  holdings: AccountHoldingsGroup[] | undefined;
  reportDate: string;
  options: HoldingsPageOptions;
}
