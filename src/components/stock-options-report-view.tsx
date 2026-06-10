"use client";

import { useViewParam } from "@/hooks/use-view-param";
import DialogTabs from "@/components/dialog-tabs";
import VestingScheduleTable from "@/components/stock-options/vesting-schedule-table";
import FutureActivityLedger from "@/components/stock-options/future-activity-ledger";
import EquityTaxImpactTable from "@/components/stock-options/equity-tax-impact-table";
import type { VestingScheduleModel } from "@/engine/equity/vesting-schedule";
import type { FutureActivityModel } from "@/engine/equity/future-activity";
import type { EquityTaxImpactModel } from "@/engine/equity/tax-impact";

type TabId = "vesting" | "activity" | "tax-impact";

const TABS = [
  { id: "vesting", label: "Vesting Schedule" },
  { id: "activity", label: "Future Activity" },
  { id: "tax-impact", label: "Tax Impact" },
];

export default function StockOptionsReportView({
  vestingModel,
  futureActivityModel,
  taxImpactModel,
}: {
  vestingModel: VestingScheduleModel;
  futureActivityModel: FutureActivityModel;
  taxImpactModel: EquityTaxImpactModel;
}) {
  const [activeTab, setActiveTab] = useViewParam<TabId>(
    ["vesting", "activity", "tax-impact"],
    "vesting",
  );

  return (
    <div className="rounded-[var(--radius)] border border-hair bg-card">
      <DialogTabs
        tabs={TABS}
        activeTab={activeTab}
        onTabChange={(id) => setActiveTab(id as TabId)}
      />
      <div className="px-[var(--pad-card)] pb-4 pt-3">
        {activeTab === "vesting" && <VestingScheduleTable model={vestingModel} />}
        {activeTab === "activity" && <FutureActivityLedger model={futureActivityModel} />}
        {activeTab === "tax-impact" && <EquityTaxImpactTable model={taxImpactModel} />}
      </div>
    </div>
  );
}
