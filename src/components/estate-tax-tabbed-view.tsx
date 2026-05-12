"use client";

import { useState } from "react";
import DialogTabs from "@/components/dialog-tabs";
import EstateTaxReportView from "./estate-tax-report-view";
import StateDeathTaxReportView from "./state-death-tax-report-view";
import type { OwnerDobs } from "./report-controls/age-helpers";

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
}

export default function EstateTaxTabbedView({
  clientId,
  isMarried,
  ownerNames,
  ownerDobs,
  retirementYear,
}: Props) {
  const [activeTab, setActiveTab] = useState<TabId>("estate");

  return (
    <div className="rounded-[var(--radius)] border border-hair bg-card">
      <DialogTabs
        tabs={TABS}
        activeTab={activeTab}
        onTabChange={(id) => setActiveTab(id as TabId)}
      />
      <div className="px-[var(--pad-card)] pb-4">
        {activeTab === "estate" ? (
          <EstateTaxReportView
            clientId={clientId}
            isMarried={isMarried}
            ownerNames={ownerNames}
            ownerDobs={ownerDobs}
            retirementYear={retirementYear}
          />
        ) : (
          <StateDeathTaxReportView clientId={clientId} />
        )}
      </div>
    </div>
  );
}
