import type { z } from "zod";
import type { ComponentType, ReactElement } from "react";
import type {
  CashFlowPageData,
  CashFlowPageOptions,
  BuildCashFlowInput,
  CoverPageData,
  CoverPageOptions,
  TocPageData,
  TocPageOptions,
} from "@/lib/presentations/types";
import {
  CASH_FLOW_PAGE_OPTIONS_DEFAULT,
  COVER_PAGE_OPTIONS_DEFAULT,
  TOC_PAGE_OPTIONS_DEFAULT,
} from "@/lib/presentations/types";
import { buildCashFlowPageData } from "@/lib/presentations/pages/cash-flow/view-model";
import { cashFlowOptionsSchema } from "@/lib/presentations/pages/cash-flow/options-schema";
import { summarizeCashFlowOptions } from "@/lib/presentations/pages/cash-flow/summarize-options";
import { estimateCashFlowPageCount } from "@/lib/presentations/pages/cash-flow/estimate-page-count";
import { coverOptionsSchema } from "@/lib/presentations/pages/cover/options-schema";
import { summarizeCoverOptions } from "@/lib/presentations/pages/cover/summarize-options";
import { estimateCoverPageCount } from "@/lib/presentations/pages/cover/estimate-page-count";
import { tocOptionsSchema } from "@/lib/presentations/pages/toc/options-schema";
import { summarizeTocOptions } from "@/lib/presentations/pages/toc/summarize-options";
import { estimateTocPageCount } from "@/lib/presentations/pages/toc/estimate-page-count";
import { CashFlowOptionsControl } from "./pages/cash-flow/options-control";
import { CashflowPagePdf } from "./pages/cash-flow/page-pdf";
import { CoverOptionsControl } from "./pages/cover/options-control";
import { CoverPdf } from "./pages/cover/page-pdf";
import { TocPdf, type TocSection } from "./pages/toc/page-pdf";
import type { ProjectionYear, ClientData } from "@/engine/types";

export interface BuildDataContext {
  years: ProjectionYear[];
  clientData: ClientData;
  scenarioLabel: string;
  clientName: string;
  spouseName: string | null;
  firmName: string;
  firmTagline: string | null;
  reportDate: string;
}

export interface RenderPdfInput<TData> {
  data: TData;
  firmName: string;
  clientName: string;
  reportDate: string;
  pageIndex: number;
  totalPages: number;
  // Only populated for pages that need cross-page layout (TOC). Other pages
  // ignore this field.
  documentSections?: TocSection[];
}

export interface PresentationPage<TData, TOptions> {
  id: string;
  title: string;
  description: string;
  defaultOptions: TOptions;
  optionsSchema: z.ZodType<TOptions>;
  summarizeOptions: (options: TOptions) => string;
  estimatePageCount: (data: TData, options: TOptions) => number;
  // Optional: pages without per-instance configuration (e.g., TOC) omit this.
  OptionsControl?: ComponentType<{ value: TOptions; onChange: (next: TOptions) => void }>;
  // False for framing pages (Cover, TOC) that don't render scenario-specific data.
  supportsScenarioOverride: boolean;
  buildData: (ctx: BuildDataContext, options: TOptions) => TData;
  renderPdf: (input: RenderPdfInput<TData>) => ReactElement;
}

export const cashFlowPage: PresentationPage<CashFlowPageData, CashFlowPageOptions> = {
  id: "cashFlow",
  title: "Cash Flow",
  description: "Annual income, expenses, withdrawals, and portfolio totals.",
  defaultOptions: CASH_FLOW_PAGE_OPTIONS_DEFAULT,
  optionsSchema: cashFlowOptionsSchema,
  summarizeOptions: summarizeCashFlowOptions,
  estimatePageCount: estimateCashFlowPageCount,
  OptionsControl: CashFlowOptionsControl,
  supportsScenarioOverride: true,
  buildData: (ctx, options) =>
    buildCashFlowPageData({
      years: ctx.years,
      clientData: ctx.clientData,
      options,
      scenarioLabel: ctx.scenarioLabel,
      clientName: ctx.clientName,
      spouseName: ctx.spouseName,
    } as BuildCashFlowInput),
  renderPdf: (input) => <CashflowPagePdf {...input} />,
};

export const coverPage: PresentationPage<CoverPageData, CoverPageOptions> = {
  id: "cover",
  title: "Cover Sheet",
  description: "Title page with firm, client, scenario, and date.",
  defaultOptions: COVER_PAGE_OPTIONS_DEFAULT,
  optionsSchema: coverOptionsSchema,
  summarizeOptions: summarizeCoverOptions,
  estimatePageCount: estimateCoverPageCount,
  OptionsControl: CoverOptionsControl,
  supportsScenarioOverride: false,
  buildData: (ctx, options) => ({
    title: options.title,
    firmName: ctx.firmName,
    firmTagline: ctx.firmTagline,
    clientName: ctx.clientName,
    spouseName: ctx.spouseName,
    scenarioLabel: ctx.scenarioLabel,
    reportDate: ctx.reportDate,
  }),
  renderPdf: ({ data }) => (
    <CoverPdf
      title={data.title}
      firmName={data.firmName}
      firmTagline={data.firmTagline}
      clientName={data.clientName}
      spouseName={data.spouseName}
      scenarioLabel={data.scenarioLabel}
      reportDate={data.reportDate}
    />
  ),
};

export const tocPage: PresentationPage<TocPageData, TocPageOptions> = {
  id: "toc",
  title: "Table of Contents",
  description: "Auto-generated contents page listing the document's sections.",
  defaultOptions: TOC_PAGE_OPTIONS_DEFAULT,
  optionsSchema: tocOptionsSchema,
  summarizeOptions: summarizeTocOptions,
  estimatePageCount: estimateTocPageCount,
  supportsScenarioOverride: false,
  buildData: () => ({}),
  renderPdf: ({ documentSections }) => (
    <TocPdf sections={documentSections ?? []} />
  ),
};

export const PRESENTATION_PAGES = {
  cover: coverPage,
  toc: tocPage,
  cashFlow: cashFlowPage,
} as const;

export type PresentationPageId = keyof typeof PRESENTATION_PAGES;
