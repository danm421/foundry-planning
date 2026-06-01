import type { BuildDataContext } from "@/components/presentations/registry";
import { buildEstateTransferReportData } from "@/lib/estate/transfer-report";
import type { EstateSummaryOptions } from "./options-schema";
import {
  summarizeHousehold,
  buildDeathRows,
  type EstateSummaryHousehold,
  type EstateSummaryDeathRow,
} from "./aggregate";
import { buildHeirRows, type EstateSummaryHeirRow } from "./heirs";
import { buildNarrative } from "./narrative";

export interface EstateSummaryChartBar {
  label: string;
  netToHeirs: number;
  federal: number;
  state: number;
  probate: number;
  ird: number;
  debts: number;
  total: number;
}

export interface EstateSummaryKpis {
  grossEstateToday: number;
  grossEstateEol: number;
  taxAndCostsToday: number;
  taxAndCostsEol: number;
  netToHeirsToday: number;
  netToHeirsEol: number;
  shrinkageToday: number;
  shrinkageEol: number;
}

export interface EstateSummaryPageData {
  title: string;
  subtitle: string;
  isMarried: boolean;
  isEmpty: boolean;
  kpis: EstateSummaryKpis;
  chart: EstateSummaryChartBar[];
  todayRows: EstateSummaryDeathRow[];
  eolRows: EstateSummaryDeathRow[];
  heirs: EstateSummaryHeirRow[];
  narrative: string[];
}

function bar(label: string, h: EstateSummaryHousehold): EstateSummaryChartBar {
  return {
    label,
    netToHeirs: h.netToHeirs,
    federal: h.federal,
    state: h.state,
    probate: h.probate,
    ird: h.ird,
    debts: h.debts,
    total: h.estateValue,
  };
}

function shrink(h: EstateSummaryHousehold): number {
  return h.estateValue > 0 ? h.taxAndCosts / h.estateValue : 0;
}

export function buildEstateSummaryData(
  ctx: BuildDataContext,
  options: EstateSummaryOptions,
): EstateSummaryPageData {
  const ownerNames = { clientName: ctx.clientName, spouseName: ctx.spouseName };
  const isMarried = ctx.spouseName != null;

  const todayReport = buildEstateTransferReportData({
    projection: ctx.projection,
    asOf: { kind: "today" },
    ordering: options.ordering,
    clientData: ctx.clientData,
    ownerNames,
  });
  const eolReport = buildEstateTransferReportData({
    projection: ctx.projection,
    asOf: { kind: "split" },
    ordering: options.ordering,
    clientData: ctx.clientData,
    ownerNames,
  });

  const today = summarizeHousehold(todayReport);
  const eol = summarizeHousehold(eolReport);
  const todayRows = buildDeathRows(todayReport);
  const eolRows = buildDeathRows(eolReport);
  const heirs = buildHeirRows(todayReport, eolReport);

  const firstDeathEolRow = eolRows.find((r) => r.deathOrder === 1);
  const firstDeathTaxedEol = (firstDeathEolRow?.federal ?? 0) + (firstDeathEolRow?.state ?? 0) > 0;

  const eolHeirNet = heirs.reduce((s, r) => s + r.eolTotal, 0);
  const eolInTrust = heirs.reduce((s, r) => s + r.eolInTrust, 0);
  const inTrustShareEol = eolHeirNet > 0 ? eolInTrust / eolHeirNet : 0;

  const todayYear = ctx.years[0]?.year ?? new Date().getFullYear();

  return {
    title: "Estate Summary",
    subtitle: `${ctx.scenarioLabel} · As of ${todayYear} vs. End of Life`,
    isMarried,
    isEmpty: todayReport.isEmpty && eolReport.isEmpty,
    kpis: {
      grossEstateToday: today.estateValue,
      grossEstateEol: eol.estateValue,
      taxAndCostsToday: today.taxAndCosts,
      taxAndCostsEol: eol.taxAndCosts,
      netToHeirsToday: today.netToHeirs,
      netToHeirsEol: eol.netToHeirs,
      shrinkageToday: shrink(today),
      shrinkageEol: shrink(eol),
    },
    chart: [bar("Today", today), bar("End of Life", eol)],
    todayRows,
    eolRows,
    heirs,
    narrative: buildNarrative({ today, eol, isMarried, firstDeathTaxedEol, inTrustShareEol }),
  };
}
