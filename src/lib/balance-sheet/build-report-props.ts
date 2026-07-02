// src/lib/balance-sheet/build-report-props.ts
import type { ClientData, ProjectionYear } from "@/engine/types";
import type {
  BalanceSheetReportProps,
  BalanceSheetProjYear,
} from "@/components/balance-sheet-report/balance-sheet-report";
import { mergeSyntheticAccounts } from "./merge-synthetic-accounts";
import { buildViewModelInputs } from "./build-view-model-inputs";
import { buildTrustDetails } from "./trust-details";

export interface BalanceSheetReportLabels {
  clientLabel: string;
  /** Candidate spouse display name — nulled out when the household has no spouse. */
  spouseName: string;
}

/**
 * Everything `BalanceSheetReport` needs except `todayYear` (callers supply
 * their own clock), derived from an engine tree + projection. Pure; shared by
 * the server-rendered Assets report page and the solver's live Balance Sheet
 * tab so the derivation can't drift between them.
 */
export function buildBalanceSheetReportProps(
  clientData: ClientData,
  years: ProjectionYear[],
  labels: BalanceSheetReportLabels,
): Omit<BalanceSheetReportProps, "todayYear"> {
  const tree = mergeSyntheticAccounts(clientData, years);
  const inputs = buildViewModelInputs(tree);

  // titlingType drives the Joint-column rule; accounts without one (engine
  // synthetics, solver drafts) fall back to null.
  const titlingById = new Map((clientData.accounts ?? []).map((a) => [a.id, a.titlingType]));
  const accounts: BalanceSheetReportProps["accounts"] = inputs.accounts.map((a) => ({
    ...a,
    titlingType: titlingById.get(a.id) ?? null,
  }));

  // Slim each projection year to the fields the report reads.
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

  const hasSpouse = (clientData.familyMembers ?? []).some((fm) => fm.role === "spouse");
  const spouseLabel = hasSpouse ? labels.spouseName : null;

  return {
    accounts,
    liabilities: inputs.liabilities,
    entities: inputs.entities,
    trustDetails: buildTrustDetails(tree, { clientLabel: labels.clientLabel, spouseLabel }),
    notesReceivable: inputs.notesReceivable,
    familyMembers: inputs.familyMembers,
    projectionYears,
    selectableYears: projectionYears.map((y) => y.year),
    agesByYear,
    clientLabel: labels.clientLabel,
    spouseLabel,
  };
}
