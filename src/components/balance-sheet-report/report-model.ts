// src/components/balance-sheet-report/report-model.ts
//
// The models behind each view of the Balance Sheet report, as pure functions
// of the report's data and the viewer's selection. The on-screen report and
// its PDF export both build through here, so the PDF prints exactly what the
// screen shows.

import type { FamilyMember, GiftEvent } from "@/engine/types";
import type { NoteLike } from "@/lib/balance-sheet/build-view-model-inputs";
import { buildViewModel, type AsOfMode, type EntityGroup, type EntityInfo, type LiabilityLike, type ProjectionYearLike } from "./view-model";
import { buildHouseholdColumns, type HouseholdAccountLike, type HouseholdProjYear } from "./household-columns";
import type { AsOfSelection } from "./year-picker";

export type BalanceSheetTab = "household" | "entities";

export const BALANCE_SHEET_TABS: readonly BalanceSheetTab[] = ["household", "entities"];

export interface BalanceSheetModelData {
  accounts: HouseholdAccountLike[];
  liabilities: LiabilityLike[];
  entities: EntityInfo[];
  notesReceivable: NoteLike[];
  familyMembers: FamilyMember[];
  projectionYears: (ProjectionYearLike & HouseholdProjYear)[];
  giftEvents?: GiftEvent[];
}

/** Household ages for a year, as the year picker shows them: "64 & 62". */
export function agesLabel(a: { client: number; spouse?: number } | undefined): string {
  if (!a) return "";
  return a.spouse != null ? `${a.client} & ${a.spouse}` : `${a.client}`;
}

/** "Today" is a beginning-of-year snapshot anchored to the first projection
 *  year (plan start); a picked year reads that year's end-of-year values. */
export function resolveAsOf(
  selectableYears: readonly number[],
  asOf: AsOfSelection,
): { selectedYear: number; asOfMode: AsOfMode } {
  return asOf.mode === "today"
    ? { selectedYear: selectableYears[0], asOfMode: "today" }
    : { selectedYear: asOf.year, asOfMode: "eoy" };
}

function sharedInput(data: BalanceSheetModelData, selectedYear: number, asOfMode: AsOfMode) {
  return {
    accounts: data.accounts,
    liabilities: data.liabilities,
    entities: data.entities,
    familyMembers: data.familyMembers,
    projectionYears: data.projectionYears,
    selectedYear,
    asOfMode,
    giftEvents: data.giftEvents,
  };
}

/** Household tab: the owner-column table, plus the consolidated model that
 *  feeds its asset pie and Out of Estate table. */
export function buildHouseholdModels(data: BalanceSheetModelData, selectedYear: number, asOfMode: AsOfMode) {
  const input = sharedInput(data, selectedYear, asOfMode);
  return {
    household: buildHouseholdColumns({ ...input, notesReceivable: data.notesReceivable }),
    consolidated: buildViewModel({ ...input, view: "consolidated" }),
  };
}

/** By Entity tab: one group per trust or business, before display prep
 *  (`prepareEntityGroups`) and the All / Trusts / Businesses filter. */
export function buildEntityGroups(data: BalanceSheetModelData, selectedYear: number, asOfMode: AsOfMode): EntityGroup[] {
  return buildViewModel({ ...sharedInput(data, selectedYear, asOfMode), view: "entities" }).entityGroups ?? [];
}
