"use client";

import { useState } from "react";
import DialogTabs from "@/components/dialog-tabs";
import EstateTransferReportView from "./estate-transfer-report-view";
import YearlyEstateReportView from "./yearly-estate-report-view";
import type { OwnerDobs } from "./report-controls/age-helpers";

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
}

export default function EstateTransferTabbedView({
  clientId,
  isMarried,
  ownerNames,
  ownerDobs,
  retirementYear,
}: Props) {
  const [activeTab, setActiveTab] = useState<TabId>("yearly");

  return (
    <div className="rounded-[var(--radius)] border border-hair bg-card">
      <DialogTabs
        tabs={TABS}
        activeTab={activeTab}
        onTabChange={(id) => setActiveTab(id as TabId)}
      />
      <div className="px-[var(--pad-card)] pb-4">
        {activeTab === "yearly" ? (
          <YearlyEstateReportView
            clientId={clientId}
            isMarried={isMarried}
            ownerNames={ownerNames}
            ownerDobs={ownerDobs}
          />
        ) : (
          <EstateTransferReportView
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
