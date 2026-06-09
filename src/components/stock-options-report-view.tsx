"use client";

import { useState } from "react";
import DialogTabs from "@/components/dialog-tabs";
import VestingScheduleTable from "@/components/stock-options/vesting-schedule-table";
import type { VestingScheduleModel } from "@/engine/equity/vesting-schedule";

type TabId = "vesting" | "activity";

const TABS = [
  { id: "vesting", label: "Vesting Schedule" },
  { id: "activity", label: "Future Activity" },
];

export default function StockOptionsReportView({ model }: { model: VestingScheduleModel }) {
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
          <VestingScheduleTable model={model} />
        ) : (
          <div className="py-16 text-center text-sm text-ink-3">
            Future Activity — coming soon.
          </div>
        )}
      </div>
    </div>
  );
}
