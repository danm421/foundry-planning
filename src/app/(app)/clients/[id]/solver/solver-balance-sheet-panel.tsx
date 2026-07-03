"use client";

import { useMemo } from "react";
import type { ClientData, ProjectionYear } from "@/engine";
import { buildBalanceSheetReportProps } from "@/lib/balance-sheet/build-report-props";
import BalanceSheetReport from "@/components/balance-sheet-report/balance-sheet-report";

interface Props {
  /** Mutated working tree — draft accounts/edits included. */
  workingTree: ClientData;
  /** Live working projection (Map fields already revived by projection-wire). */
  years: ProjectionYear[];
  clientName: string;
  spouseName: string;
}

/**
 * Solver right-pane Balance Sheet report: the same interactive report the
 * Assets → Balance Sheet Report page renders, derived client-side from the
 * solver's live working state. Labels come from the tree-derived names the
 * solver already holds (the standalone page prefers CRM contact first names —
 * deliberate divergence, see the spec).
 */
export function SolverBalanceSheetPanel({ workingTree, years, clientName, spouseName }: Props) {
  const report = useMemo(() => {
    if (years.length === 0) return null;
    return buildBalanceSheetReportProps(workingTree, years, { clientLabel: clientName, spouseName });
  }, [workingTree, years, clientName, spouseName]);

  if (!report) {
    return <p className="py-4 text-[12px] text-ink-3">No projection available yet.</p>;
  }

  return <BalanceSheetReport {...report} todayYear={new Date().getFullYear()} summaryPlacement="top" />;
}
