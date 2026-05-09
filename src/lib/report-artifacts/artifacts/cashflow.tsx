import { z } from "zod";
import type { ReactNode } from "react";
import type { ReportArtifact, FetchDataResult, RenderPdfInput, CsvFile } from "../types";

export const optionsSchema = z.object({
  scenarioId: z.string().nullable().default(null),
  yearStart: z.number().int().nullable().default(null),
  yearEnd: z.number().int().nullable().default(null),
});
export type CashflowOptions = z.infer<typeof optionsSchema>;

export type CashflowSectionId = "base" | "income" | "expenses" | "withdrawals" | "assets";

export type CashflowSection = {
  id: CashflowSectionId;
  title: string;
  headers: { id: string; label: string; align: "left" | "right" }[];
  rows: CashflowRow[];
  totals: Record<string, number>;
};

export type CashflowRow = {
  year: number;
  age: string;
  cells: Record<string, number>;
};

export type CashflowData = {
  clientName: string;
  scenarioLabel: string;
  yearRange: [number, number];
  sections: Record<CashflowSectionId, CashflowSection>;
};

async function fetchCashflowData(
  _clientId: string,
  _firmId: string,
  _opts: CashflowOptions,
): Promise<FetchDataResult<CashflowData>> {
  throw new Error("not implemented");
}

function renderCashflowPdf(_input: RenderPdfInput<CashflowData, CashflowOptions>): ReactNode {
  throw new Error("not implemented");
}

function cashflowToCsv(_data: CashflowData, _opts: CashflowOptions): CsvFile[] {
  throw new Error("not implemented");
}

export const cashflowArtifact: ReportArtifact<CashflowData, typeof optionsSchema> = {
  id: "cashflow",
  title: "Cash Flow",
  section: "cashflow",
  route: "/clients/[id]/cashflow",
  variants: ["chart", "data", "chart+data", "csv"],
  optionsSchema,
  defaultOptions: { scenarioId: null, yearStart: null, yearEnd: null },
  fetchData: ({ clientId, firmId, opts }) => fetchCashflowData(clientId, firmId, opts),
  renderPdf: renderCashflowPdf,
  toCsv: cashflowToCsv,
};
