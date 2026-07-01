// src/components/balance-sheet-report/balance-sheet-report.tsx
"use client";

import { useMemo, useState } from "react";
import { useViewParam } from "@/hooks/use-view-param";
import type { FamilyMember } from "@/engine/types";
import type { LiabilityLike, EntityInfo, ProjectionYearLike, AsOfMode } from "./view-model";
import { buildViewModel } from "./view-model";
import {
  buildHouseholdColumns,
  type HouseholdProjYear,
  type HouseholdAccountLike,
} from "./household-columns";
import type { NoteLike } from "@/lib/balance-sheet/build-view-model-inputs";
import YearPicker, { type AgesByYear, type AsOfSelection } from "./year-picker";
import HouseholdTable from "./household-table";
import HouseholdSummaryPanel from "./household-summary-panel";
import OutOfEstateTable from "./out-of-estate-table";
import EntityBalanceSheets from "./entity-balance-sheets";

/** Per-year payload the report needs: satisfies both view-model and household helpers. */
export type BalanceSheetProjYear = ProjectionYearLike & HouseholdProjYear;

export interface BalanceSheetReportProps {
  accounts: HouseholdAccountLike[];
  liabilities: LiabilityLike[];
  entities: EntityInfo[];
  notesReceivable: NoteLike[];
  familyMembers: FamilyMember[];
  /** Slim per-year data: must satisfy both ProjectionYearLike (for buildViewModel)
   *  and HouseholdProjYear (for buildHouseholdColumns). */
  projectionYears: BalanceSheetProjYear[];
  selectableYears: number[];
  /** Household ages per year, for the year picker. Defaults to none. */
  agesByYear?: AgesByYear;
  /** Current calendar year — its picker option reads "Today (YYYY)". */
  todayYear?: number;
  clientLabel: string;
  spouseLabel: string | null;
}

type Tab = "household" | "entities";

export default function BalanceSheetReport(props: BalanceSheetReportProps) {
  const { selectableYears } = props;
  // Default to "Today" — a beginning-of-year snapshot of the advisor-entered
  // current balances, distinct from the current year's end-of-year projection.
  const [asOf, setAsOf] = useState<AsOfSelection>({ mode: "today" });
  const asOfMode: AsOfMode = asOf.mode === "today" ? "today" : "eoy";
  // "Today" anchors to the first projection year (plan start); "eoy" uses the
  // picked year.
  const selectedYear = asOf.mode === "today" ? selectableYears[0] : asOf.year;
  const [tab, setTab] = useViewParam<Tab>(["household", "entities"], "household");

  const household = useMemo(
    () =>
      buildHouseholdColumns({
        accounts: props.accounts,
        liabilities: props.liabilities,
        entities: props.entities,
        notesReceivable: props.notesReceivable,
        familyMembers: props.familyMembers,
        projectionYears: props.projectionYears,
        selectedYear,
        asOfMode,
      }),
    [props.accounts, props.liabilities, props.entities, props.notesReceivable, props.familyMembers, props.projectionYears, selectedYear, asOfMode],
  );

  const consolidated = useMemo(
    () =>
      buildViewModel({
        accounts: props.accounts,
        liabilities: props.liabilities,
        entities: props.entities,
        familyMembers: props.familyMembers,
        projectionYears: props.projectionYears,
        selectedYear,
        view: "consolidated",
        asOfMode,
      }),
    [props.accounts, props.liabilities, props.entities, props.familyMembers, props.projectionYears, selectedYear, asOfMode],
  );

  const entityModel = useMemo(
    () =>
      tab === "entities"
        ? buildViewModel({
            accounts: props.accounts,
            liabilities: props.liabilities,
            entities: props.entities,
            familyMembers: props.familyMembers,
            projectionYears: props.projectionYears,
            selectedYear,
            view: "entities",
            asOfMode,
          })
        : null,
    [tab, props.accounts, props.liabilities, props.entities, props.familyMembers, props.projectionYears, selectedYear, asOfMode],
  );

  const tabClass = (active: boolean) =>
    active
      ? "rounded-md border border-accent bg-card-2 px-3 py-1 text-xs font-medium text-accent"
      : "rounded-md border border-transparent px-3 py-1 text-xs text-ink-2 hover:bg-card-2 hover:text-ink";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div role="tablist" aria-label="Balance sheet views" className="flex gap-1">
          <button type="button" role="tab" aria-selected={tab === "household"} className={tabClass(tab === "household")} onClick={() => setTab("household")}>
            Household
          </button>
          <button type="button" role="tab" aria-selected={tab === "entities"} className={tabClass(tab === "entities")} onClick={() => setTab("entities")}>
            By Entity
          </button>
        </div>
        <YearPicker
          years={selectableYears}
          value={asOf}
          onChange={setAsOf}
          agesByYear={props.agesByYear}
          todayYear={props.todayYear}
        />
      </div>

      {tab === "household" ? (
        <>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
            <div className="lg:w-80 lg:shrink-0">
              <HouseholdSummaryPanel
                donut={consolidated.donut}
                totalAssets={household.totalAssets}
                totalLiabilities={household.totalLiabilities}
                netWorth={household.netWorth}
                hasSpouse={household.hasSpouse}
                clientLabel={props.clientLabel}
                spouseLabel={props.spouseLabel}
              />
            </div>
            <div className="min-w-0 flex-1">
              <HouseholdTable model={household} clientLabel={props.clientLabel} spouseLabel={props.spouseLabel} />
            </div>
          </div>
          <OutOfEstateTable vm={consolidated} />
        </>
      ) : (
        <EntityBalanceSheets groups={entityModel?.entityGroups ?? []} />
      )}
    </div>
  );
}
