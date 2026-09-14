"use client";

import { useViewParam } from "@/hooks/use-view-param";
import DialogTabs from "@/components/dialog-tabs";
import EstateTaxReportView from "./estate-tax-report-view";
import StateDeathTaxReportView from "./state-death-tax-report-view";
import { EstateCompareShell } from "./estate-compare-shell";
import type { ScenarioOption } from "./scenario/scenario-picker-dropdown";
import type { OwnerDobs } from "./report-controls/age-helpers";
import type { EstateTaxColumnData } from "@/lib/estate/diff-estate-tax";

type TabId = "estate" | "state";

const TABS = [
  { id: "estate", label: "Estate Tax" },
  { id: "state", label: "State Death Tax" },
];

interface Props {
  clientId: string;
  isMarried: boolean;
  ownerNames: { clientName: string; spouseName: string | null };
  ownerDobs: OwnerDobs;
  retirementYear: number;
  /** Options for the compare pickers, base case first. */
  scenarios: ScenarioOption[];
}

export default function EstateTaxTabbedView({
  clientId,
  isMarried,
  ownerNames,
  ownerDobs,
  retirementYear,
  scenarios,
}: Props) {
  const [activeTab, setActiveTab] = useViewParam<TabId>(["estate", "state"], "estate");

  return (
    <div className="rounded-[var(--radius)] border border-hair bg-card">
      <DialogTabs
        tabs={TABS}
        activeTab={activeTab}
        onTabChange={(id) => setActiveTab(id as TabId)}
      />
      <div className="px-[var(--pad-card)] pb-4">
        {/*
          ONE shell for both tabs. Both report views take the identical column
          contract and report the same `EstateTaxColumnData`, so the
          scenario pickers, the shared As-of row and the compare selection
          survive a tab switch instead of resetting to Today on every visit.

          State Death Tax opts OUT of the half-width solo affordance: its PA
          inheritance table needs 672px and half a 1440px viewport gives it
          597px, so the "Tax" column of a tax report lands off screen while the
          right half of the page sits empty.
        */}
        <EstateCompareShell<EstateTaxColumnData>
          clientId={clientId}
          scenarios={scenarios}
          isMarried={isMarried}
          ownerNames={ownerNames}
          ownerDobs={ownerDobs}
          retirementYear={retirementYear}
          soloFullWidth={activeTab === "state"}
        >
          {({ scenarioRef, asOf, ordering, onReady, baseline }) => {
            const columnProps = {
              clientId,
              isMarried,
              ownerNames,
              ownerDobs,
              retirementYear,
              scenarioRef,
              asOf,
              ordering,
              onReady,
              baseline,
            };
            return activeTab === "estate" ? (
              <EstateTaxReportView {...columnProps} />
            ) : (
              <StateDeathTaxReportView {...columnProps} />
            );
          }}
        </EstateCompareShell>
      </div>
    </div>
  );
}
