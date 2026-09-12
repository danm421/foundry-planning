"use client";

import { useViewParam } from "@/hooks/use-view-param";
import DialogTabs from "@/components/dialog-tabs";
import EstateTaxReportView from "./estate-tax-report-view";
import StateDeathTaxReportView from "./state-death-tax-report-view";
import { EstateCompareShell } from "./estate-compare-shell";
import type { ScenarioOption } from "./scenario/scenario-picker-dropdown";
import type { OwnerDobs } from "./report-controls/age-helpers";
import type { EstateTaxResult } from "@/engine/types";

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
        {activeTab === "estate" ? (
          <EstateCompareShell<EstateTaxResult>
            clientId={clientId}
            scenarios={scenarios}
            isMarried={isMarried}
            ownerNames={ownerNames}
            ownerDobs={ownerDobs}
            retirementYear={retirementYear}
          >
            {({ scenarioRef, asOf, ordering, onReady, baseline }) => (
              <EstateTaxReportView
                clientId={clientId}
                isMarried={isMarried}
                ownerNames={ownerNames}
                ownerDobs={ownerDobs}
                retirementYear={retirementYear}
                scenarioRef={scenarioRef}
                asOf={asOf}
                ordering={ordering}
                onReady={onReady}
                baseline={baseline}
              />
            )}
          </EstateCompareShell>
        ) : (
          <StateDeathTaxReportView
            clientId={clientId}
            isMarried={isMarried}
            ownerNames={ownerNames}
            ownerDobs={ownerDobs}
            retirementYear={retirementYear}
          />
        )}
      </div>
    </div>
  );
}
