"use client";

import { useState } from "react";
import DialogTabs from "@/components/dialog-tabs";
import VestingScheduleTable from "@/components/stock-options/vesting-schedule-table";
import FutureActivityLedger from "@/components/stock-options/future-activity-ledger";
import type { VestingScheduleModel } from "@/engine/equity/vesting-schedule";
import type { FutureActivityModel } from "@/engine/equity/future-activity";

type TabId = "vesting" | "activity";

const TABS = [
  { id: "vesting", label: "Vesting Schedule" },
  { id: "activity", label: "Future Activity" },
];

export default function StockOptionsReportView({
  vestingModel,
  futureActivityModel,
}: {
  vestingModel: VestingScheduleModel;
  futureActivityModel: FutureActivityModel;
}) {
  const [activeTab, setActiveTab] = useState<TabId>("vesting");

  return (
    <div className="rounded-[var(--radius)] border border-hair bg-card">
      <DialogTabs
        tabs={TABS}
        activeTab={activeTab}
        onTabChange={(id) => setActiveTab(id as TabId)}
      />
      <div className="px-[var(--pad-card)] pb-4 pt-3">
        {activeTab === "vesting" ? (
          <VestingScheduleTable model={vestingModel} />
        ) : (
          <FutureActivityLedger model={futureActivityModel} />
        )}
      </div>
    </div>
  );
}
