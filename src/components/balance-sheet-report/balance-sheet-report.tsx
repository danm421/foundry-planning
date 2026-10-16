// src/components/balance-sheet-report/balance-sheet-report.tsx
"use client";

import { useMemo, useState } from "react";
import { useViewParam } from "@/hooks/use-view-param";
import type { FamilyMember, GiftEvent } from "@/engine/types";
import type { LiabilityLike, EntityInfo, ProjectionYearLike } from "./view-model";
import type { HouseholdProjYear, HouseholdAccountLike } from "./household-columns";
import type { NoteLike } from "@/lib/balance-sheet/build-view-model-inputs";
import type { TrustDetails } from "@/lib/balance-sheet/trust-details";
import type { EntityFilter } from "@/lib/balance-sheet/entity-groups";
import { BALANCE_SHEET_TABS, buildEntityGroups, buildHouseholdModels, resolveAsOf, type BalanceSheetTab } from "./report-model";
import YearPicker, { type AgesByYear, type AsOfSelection } from "./year-picker";
import HouseholdTable from "./household-table";
import HouseholdSummaryPanel from "./household-summary-panel";
import OutOfEstateTable from "./out-of-estate-table";
import EntityBalanceSheets from "./entity-balance-sheets";
import BalanceSheetPdfButton from "@/components/balance-sheet-pdf-button";

/** Per-year payload the report needs: satisfies both view-model and household helpers. */
export type BalanceSheetProjYear = ProjectionYearLike & HouseholdProjYear;

export interface BalanceSheetReportProps {
  accounts: HouseholdAccountLike[];
  liabilities: LiabilityLike[];
  entities: EntityInfo[];
  /** Display-ready trust attributes for the By-Entity tab's detail cards. */
  trustDetails?: TrustDetails[];
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
  /** Where the pie/net-worth summary sits relative to the household table.
   *  "side" (default) is a left column; "top" stacks it full-width above the
   *  table — used in narrow hosts like the solver pane. */
  summaryPlacement?: "side" | "top";
  /** Lifetime gift events, so ownership is resolved as of the picked year
   *  rather than as authored. Without them a gifted share of an asset stays on
   *  the household's balance sheet at full value forever. */
  giftEvents?: GiftEvent[];
  /** Shows the Download PDF button, which exports exactly the view on screen
   *  (tab, year and entity filter). Omitted by hosts with nothing saved to
   *  export, like the solver's live preview. */
  pdfClientId?: string;
}

export default function BalanceSheetReport(props: BalanceSheetReportProps) {
  const { accounts, liabilities, entities, notesReceivable, familyMembers, projectionYears, giftEvents, selectableYears } = props;
  // Default to "Today" — a beginning-of-year snapshot of the advisor-entered
  // current balances, distinct from the current year's end-of-year projection.
  const [asOf, setAsOf] = useState<AsOfSelection>({ mode: "today" });
  const { selectedYear, asOfMode } = resolveAsOf(selectableYears, asOf);
  const [tab, setTab] = useViewParam<BalanceSheetTab>(BALANCE_SHEET_TABS, "household");
  const [entityFilter, setEntityFilter] = useState<EntityFilter>("all");

  const data = useMemo(
    () => ({ accounts, liabilities, entities, notesReceivable, familyMembers, projectionYears, giftEvents }),
    [accounts, liabilities, entities, notesReceivable, familyMembers, projectionYears, giftEvents],
  );
  const { household, consolidated } = useMemo(
    () => buildHouseholdModels(data, selectedYear, asOfMode),
    [data, selectedYear, asOfMode],
  );
  const entityGroups = useMemo(
    () => (tab === "entities" ? buildEntityGroups(data, selectedYear, asOfMode) : []),
    [tab, data, selectedYear, asOfMode],
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
        <div className="flex items-center gap-2">
          <YearPicker
            years={selectableYears}
            value={asOf}
            onChange={setAsOf}
            agesByYear={props.agesByYear}
            todayYear={props.todayYear}
          />
          {props.pdfClientId && (
            <BalanceSheetPdfButton clientId={props.pdfClientId} tab={tab} asOf={asOf} entityFilter={entityFilter} />
          )}
        </div>
      </div>

      {tab === "household" ? (
        <>
          {props.summaryPlacement === "top" ? (
            <>
              <HouseholdSummaryPanel
                donut={consolidated.donut}
                totalAssets={household.totalAssets}
                totalLiabilities={household.totalLiabilities}
                netWorth={household.netWorth}
                hasSpouse={household.hasSpouse}
                clientLabel={props.clientLabel}
                spouseLabel={props.spouseLabel}
                layout="row"
              />
              <HouseholdTable model={household} clientLabel={props.clientLabel} spouseLabel={props.spouseLabel} />
            </>
          ) : (
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
          )}
          <OutOfEstateTable vm={consolidated} />
        </>
      ) : (
        <EntityBalanceSheets
          groups={entityGroups}
          trustDetails={props.trustDetails ?? []}
          filter={entityFilter}
          onFilterChange={setEntityFilter}
        />
      )}
    </div>
  );
}
