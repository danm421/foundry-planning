// src/components/balance-sheet-report/balance-sheet-report.tsx
"use client";

import { useMemo, useState } from "react";
import type { FamilyMember } from "@/engine/types";
import type { AccountLike, LiabilityLike, EntityInfo, ProjectionYearLike } from "./view-model";
import { buildViewModel } from "./view-model";
import {
  buildHouseholdColumns,
  type HouseholdProjYear,
  type HouseholdAccountLike,
} from "./household-columns";
import type { NoteLike } from "@/lib/balance-sheet/build-view-model-inputs";
import YearPicker from "./year-picker";
import HouseholdTable from "./household-table";
import OutOfEstateTable from "./out-of-estate-table";
import EntityBalanceSheets from "./entity-balance-sheets";

export interface BalanceSheetReportProps {
  accounts: HouseholdAccountLike[];
  liabilities: LiabilityLike[];
  entities: EntityInfo[];
  notesReceivable: NoteLike[];
  familyMembers: FamilyMember[];
  /** Slim per-year data: must satisfy both ProjectionYearLike (for buildViewModel)
   *  and HouseholdProjYear (for buildHouseholdColumns). */
  projectionYears: Array<ProjectionYearLike & HouseholdProjYear>;
  selectableYears: number[];
  defaultYear: number;
  clientLabel: string;
  spouseLabel: string | null;
}

type Tab = "household" | "entities";

export default function BalanceSheetReport(props: BalanceSheetReportProps) {
  const { selectableYears, defaultYear } = props;
  const [year, setYear] = useState(
    selectableYears.includes(defaultYear) ? defaultYear : selectableYears[0],
  );
  const [tab, setTab] = useState<Tab>("household");

  const accounts: AccountLike[] = props.accounts;

  const household = useMemo(
    () =>
      buildHouseholdColumns({
        accounts: props.accounts,
        liabilities: props.liabilities,
        entities: props.entities,
        notesReceivable: props.notesReceivable,
        familyMembers: props.familyMembers,
        projectionYears: props.projectionYears,
        selectedYear: year,
      }),
    [props, year],
  );

  const consolidated = useMemo(
    () =>
      buildViewModel({
        accounts,
        liabilities: props.liabilities,
        entities: props.entities,
        familyMembers: props.familyMembers,
        projectionYears: props.projectionYears,
        selectedYear: year,
        view: "consolidated",
      }),
    [accounts, props.liabilities, props.entities, props.familyMembers, props.projectionYears, year],
  );

  const entityModel = useMemo(
    () =>
      tab === "entities"
        ? buildViewModel({
            accounts,
            liabilities: props.liabilities,
            entities: props.entities,
            familyMembers: props.familyMembers,
            projectionYears: props.projectionYears,
            selectedYear: year,
            view: "entities",
          })
        : null,
    [tab, accounts, props.liabilities, props.entities, props.familyMembers, props.projectionYears, year],
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
        <YearPicker years={selectableYears} value={year} onChange={setYear} />
      </div>

      {tab === "household" ? (
        <>
          <HouseholdTable model={household} clientLabel={props.clientLabel} spouseLabel={props.spouseLabel} />
          <OutOfEstateTable vm={consolidated} />
        </>
      ) : (
        <EntityBalanceSheets groups={entityModel?.entityGroups ?? []} />
      )}
    </div>
  );
}
