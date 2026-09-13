"use client";

import { useViewParam } from "@/hooks/use-view-param";
import DialogTabs from "@/components/dialog-tabs";
import EstateTransferReportView from "./estate-transfer-report-view";
import YearlyEstateReportView from "./yearly-estate-report-view";
import { EstateCompareShell } from "./estate-compare-shell";
import type { ScenarioOption } from "./scenario/scenario-picker-dropdown";
import type { OwnerDobs } from "./report-controls/age-helpers";
import type { EstateTransferReportData } from "@/lib/estate/transfer-report";

type TabId = "yearly" | "transfers";

const TABS = [
  { id: "yearly", label: "Year-by-Year" },
  { id: "transfers", label: "Transfer Detail" },
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

export default function EstateTransferTabbedView({
  clientId,
  isMarried,
  ownerNames,
  ownerDobs,
  retirementYear,
  scenarios,
}: Props) {
  const [activeTab, setActiveTab] = useViewParam<TabId>(["yearly", "transfers"], "yearly");

  return (
    <div className="rounded-[var(--radius)] border border-hair bg-card">
      <DialogTabs
        tabs={TABS}
        activeTab={activeTab}
        onTabChange={(id) => setActiveTab(id as TabId)}
      />
      <div className="px-[var(--pad-card)] pb-4">
        {activeTab === "yearly" ? (
          // Year-by-Year is NOT a compare column: it takes different props and
          // renders a different data shape, so it stays outside the shell and
          // full width. The shell wraps the Transfer Detail tab alone.
          <YearlyEstateReportView
            clientId={clientId}
            isMarried={isMarried}
            ownerNames={ownerNames}
            ownerDobs={ownerDobs}
          />
        ) : (
          <EstateCompareShell<EstateTransferReportData>
            clientId={clientId}
            scenarios={scenarios}
            isMarried={isMarried}
            ownerNames={ownerNames}
            ownerDobs={ownerDobs}
            retirementYear={retirementYear}
          >
            {({ scenarioRef, asOf, ordering, onReady, baseline }) => (
              <EstateTransferReportView
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
        )}
      </div>
    </div>
  );
}
