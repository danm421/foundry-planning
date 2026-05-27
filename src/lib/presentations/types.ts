// Shared type declarations for the Presentations subsystem.
// Pure data — no React, no react-pdf, no engine internals.

import type { ClientData, ProjectionYear } from "@/engine/types";

// ── Page-level ──────────────────────────────────────────────────────────────

export interface PresentationPageDescriptor {
  pageId: string;                            // "cashFlow"
  options?: Record<string, unknown>;         // per-page options bag
}

export interface PresentationCompositionInput {
  clientId: string;
  scenarioId: string | null;
  scenarioLabel: string;                     // "Base Case" or scenario name
  pages: PresentationPageDescriptor[];
}

// ── Cash-flow page ─────────────────────────────────────────────────────────

export interface CashFlowPageOptions {
  range: "retirement" | "lifetime" | { startYear: number; endYear: number };
  showCallout: boolean;
  calloutText?: string;
}

export const CASH_FLOW_PAGE_OPTIONS_DEFAULT: CashFlowPageOptions = {
  range: "retirement",
  showCallout: true,
};

export interface CashFlowTableRow {
  year: number;
  ageClient: number | null;
  ageSpouse: number | null;
  cells: {
    totalExpenses: number;
    salary: number;
    socialSecurity: number;
    otherIncome: number;
    rmds: number;
    withdrawals: number;
    totalWithdrawalsSpent: number;
    netSavings: number;
    totalPortfolioAssets: number;
  };
}

export interface TableMarker {
  year: number;
  kind: "retirement" | "endOfLife";
  who: "client" | "spouse" | "joint";
  label: string;
}

export interface CashFlowPageData {
  title: string;                             // "Cash Flow"
  subtitle: string;                          // scenario label
  callout?: string;
  chartSpec: import("./charts/types").ChartSpec;
  table: {
    rows: CashFlowTableRow[];
    markers: TableMarker[];
  };
  footnote: string;
}

export interface BuildCashFlowInput {
  years: ProjectionYear[];
  clientData: ClientData;
  options: CashFlowPageOptions;
  scenarioLabel: string;
  clientName: string;                        // for marker labels: "Cooper — Retirement"
  spouseName: string | null;
}
