import type { BuildDataContext } from "@/components/presentations/registry";
import type { ProjectionResult } from "@/engine/projection";
import type {
  AsOfSelection,
  EstateTransferReportData,
} from "@/lib/estate/transfer-report";
import { buildEstateTransferReportData } from "@/lib/estate/transfer-report";
import {
  buildOwnershipColumn,
  type OwnershipColumnData,
} from "@/lib/estate/estate-flow-ownership";
import {
  buildEstateFlowSummary,
  type EstateFlowSummary,
} from "@/lib/estate/estate-flow-summary";

export interface EstatePrep {
  reportData: EstateTransferReportData;
  ownership: OwnershipColumnData;
  summary: EstateFlowSummary | null;
  planStartYear: number;
  planEndYear: number;
  asOfYear: number;
}

/** today/split → plan start year; explicit year → that year. Falls back to the
 *  current calendar year when the projection has no rows. */
export function resolveAsOfYear(
  asOf: AsOfSelection,
  projection: ProjectionResult,
): number {
  if (asOf.kind === "year") return asOf.year;
  return projection.years[0]?.year ?? new Date().getFullYear();
}

/**
 * Wire the estate libs together from a presentation build context. V1 passes
 * `gifts: []` (see plan: persisted gifts are already baked into clientData /
 * projection by loadClientData; the draft list only drives annotations).
 */
export function prepEstate(
  ctx: BuildDataContext,
  asOf: AsOfSelection,
): EstatePrep {
  const ownerNames = { clientName: ctx.clientName, spouseName: ctx.spouseName };
  const planStartYear =
    ctx.projection.years[0]?.year ?? new Date().getFullYear();
  const planEndYear =
    ctx.projection.years[ctx.projection.years.length - 1]?.year ?? planStartYear;
  const asOfYear = resolveAsOfYear(asOf, ctx.projection);

  const reportData = buildEstateTransferReportData({
    projection: ctx.projection,
    asOf,
    ordering: "primaryFirst",
    clientData: ctx.clientData,
    ownerNames,
  });

  const ownership = buildOwnershipColumn(ctx.clientData, {
    projection: ctx.projection,
    asOfYear,
    todayYear: planStartYear,
    gifts: [],
  });

  const summary = buildEstateFlowSummary({
    reportData,
    clientData: ctx.clientData,
    gifts: [],
    ownerNames,
    asOfYear,
    projection: ctx.projection,
  });

  return { reportData, ownership, summary, planStartYear, planEndYear, asOfYear };
}
