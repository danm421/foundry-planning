// Shared type declarations for the Presentations subsystem.
// Pure data — no React, no react-pdf, no engine internals.

import type { ClientData, ProjectionYear } from "@/engine/types";

// ── Page-level ──────────────────────────────────────────────────────────────

export interface PresentationPageDescriptor {
  pageId: string;                            // "cashFlow" (narrowed to PresentationPageId at the API boundary)
  options: unknown;                          // per-page options bag (required)
}

export interface PresentationCompositionInput {
  clientId: string;
  scenarioId: string | null;
  scenarioLabel: string;                     // "Base Case" or scenario name
  pages: PresentationPageDescriptor[];
}

// ── Cover page ─────────────────────────────────────────────────────────────

export interface CoverPageOptions {
  title: string;                             // optional document title rendered above the firm name; empty = hidden
}

export const COVER_PAGE_OPTIONS_DEFAULT: CoverPageOptions = {
  title: "",
};

export interface CoverPageData {
  title: string;
  firmName: string;
  firmTagline: string | null;
  clientName: string;
  spouseName: string | null;
  scenarioLabel: string;
  reportDate: string;
  /** Cream-panel logo data URL: firm logo, or the Foundry default. Null = wordmark fallback. */
  logoDataUrl: string | null;
  /** Diagonal stripes + rules; firm primaryColor or the report gold fallback. */
  accentColor: string;
}

// ── Table of contents ──────────────────────────────────────────────────────

export type TocPageOptions = Record<string, never>;

export const TOC_PAGE_OPTIONS_DEFAULT: TocPageOptions = {};

// TOC sections are computed by the document composer (they need cross-page page
// counts) and read off the renderPdf input. `buildData` supplies the formal
// household name for the disclaimer, since the renderPdf `clientName` prop now
// carries the compact running-header name (both first names).
export type TocPageData = { clientName: string };

// ── Cash-flow page ─────────────────────────────────────────────────────────

export interface CashFlowPageOptions {
  range: "full" | { startYear: number; endYear: number };
  showCallout: boolean;
  calloutText?: string;
}

export const CASH_FLOW_PAGE_OPTIONS_DEFAULT: CashFlowPageOptions = {
  range: "full",
  showCallout: true,
};

export interface CashFlowTableRow {
  year: number;
  ageClient: number | null;
  ageSpouse: number | null;
  cells: {
    // Chart-stack components (also feed table totals)
    salary: number;             // r.income.salaries
    socialSecurity: number;     // r.income.socialSecurity
    otherInflows: number;       // business + deferred + capitalGains + trust + other
    rmds: number;               // sum of rmd ledger entries (= sum of l.rmdAmount)
    withdrawals: number;        // r.withdrawals.total (chart-only — table shows it under Net Cash Flow)

    // Table summary columns
    totalIncome: number;        // r.totalIncome
    expenses: number;           // r.expenses.total
    savings: number;            // r.savings.total
    totalExpenses: number;      // r.totalExpenses (= expenses + savings)
    netCashFlow: number;        // r.netCashFlow
    portfolioGrowth: number;    // sum of ledger.growth over portfolio accounts
    portfolioActivity: number;  // externalContributions − externalDistributions
    portfolioAssets: number;    // liquid: taxable + cash + retirement + lifeInsurance
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
