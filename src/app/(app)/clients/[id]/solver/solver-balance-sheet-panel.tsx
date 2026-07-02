"use client";

import { useMemo } from "react";
import type { ClientData, ProjectionYear } from "@/engine";
import { buildViewModelInputs } from "@/lib/balance-sheet/build-view-model-inputs";
import { buildTrustDetails } from "@/lib/balance-sheet/trust-details";
import { mergeSyntheticAccounts } from "@/lib/balance-sheet/merge-synthetic-accounts";
import BalanceSheetReport, {
  type BalanceSheetReportProps,
  type BalanceSheetProjYear,
} from "@/components/balance-sheet-report/balance-sheet-report";

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
 * solver's live working state. Mirrors the server-side derivation in
 * balance-sheet-report-content.tsx — keep the two in sync.
 */
export function SolverBalanceSheetPanel({ workingTree, years, clientName, spouseName }: Props) {
  const report = useMemo<Omit<BalanceSheetReportProps, "todayYear"> | null>(() => {
    if (years.length === 0) return null;

    const tree = mergeSyntheticAccounts(workingTree, years);
    const inputs = buildViewModelInputs(tree);

    // titlingType drives the Joint-column rule; solver drafts without one
    // fall back to null, same as the standalone page.
    const titlingById = new Map((workingTree.accounts ?? []).map((a) => [a.id, a.titlingType]));
    const accounts: BalanceSheetReportProps["accounts"] = inputs.accounts.map((a) => ({
      ...a,
      titlingType: titlingById.get(a.id) ?? null,
    }));

    // Slim each projection year to the fields the report reads — the same
    // seven the standalone page passes.
    const projectionYears = years.map((y) => ({
      year: y.year,
      portfolioAssets: y.portfolioAssets,
      accountLedgers: y.accountLedgers,
      liabilityBalancesBoY: y.liabilityBalancesBoY,
      notesReceivableByNote: y.notesReceivableByNote,
      entityAccountSharesEoY: y.entityAccountSharesEoY,
      familyAccountSharesEoY: y.familyAccountSharesEoY,
    })) satisfies BalanceSheetProjYear[];

    const agesByYear: Record<number, { client: number; spouse?: number }> = {};
    for (const y of years) agesByYear[y.year] = y.ages;

    // Labels come from the tree-derived names the solver already holds (the
    // standalone page prefers CRM contact first names — deliberate divergence,
    // see the spec).
    const hasSpouse = (workingTree.familyMembers ?? []).some((fm) => fm.role === "spouse");
    const spouseLabel = hasSpouse ? spouseName : null;

    return {
      accounts,
      liabilities: inputs.liabilities,
      entities: inputs.entities,
      trustDetails: buildTrustDetails(tree, { clientLabel: clientName, spouseLabel }),
      notesReceivable: inputs.notesReceivable,
      familyMembers: inputs.familyMembers,
      projectionYears,
      selectableYears: projectionYears.map((y) => y.year),
      agesByYear,
      clientLabel: clientName,
      spouseLabel,
    };
  }, [workingTree, years, clientName, spouseName]);

  if (!report) {
    return <p className="py-4 text-[12px] text-ink-3">No projection available yet.</p>;
  }

  return <BalanceSheetReport {...report} todayYear={new Date().getFullYear()} />;
}
