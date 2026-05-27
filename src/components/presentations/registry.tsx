import type { CashFlowPageData, CashFlowPageOptions, BuildCashFlowInput } from "@/lib/presentations/types";
import { CASH_FLOW_PAGE_OPTIONS_DEFAULT } from "@/lib/presentations/types";
import { buildCashFlowPageData } from "@/lib/presentations/pages/cash-flow/view-model";
import type { ProjectionYear, ClientData } from "@/engine/types";
import { CashflowPagePdf } from "./pages/cash-flow/page-pdf";
import type { ReactElement } from "react";

export interface BuildDataContext {
  years: ProjectionYear[];
  clientData: ClientData;
  scenarioLabel: string;
  clientName: string;
  spouseName: string | null;
}

export interface PresentationPage<TData, TOptions> {
  id: string;
  title: string;
  description: string;
  defaultOptions: TOptions;
  buildData: (ctx: BuildDataContext, options: TOptions) => TData;
  renderPdf: (input: {
    data: TData;
    firmName: string;
    clientName: string;
    reportDate: string;
    pageIndex: number;
    totalPages: number;
  }) => ReactElement;
}

export const cashFlowPage: PresentationPage<CashFlowPageData, CashFlowPageOptions> = {
  id: "cashFlow",
  title: "Cash Flow",
  description: "Annual income, expenses, withdrawals, and portfolio totals.",
  defaultOptions: CASH_FLOW_PAGE_OPTIONS_DEFAULT,
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

export const PRESENTATION_PAGES = {
  cashFlow: cashFlowPage,
} as const;

export type PresentationPageId = keyof typeof PRESENTATION_PAGES;
