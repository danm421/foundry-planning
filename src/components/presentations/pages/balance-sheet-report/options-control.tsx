"use client";
import {
  BALANCE_SHEET_REPORT_VIEWS,
  type BalanceSheetReportOptions,
} from "@/lib/presentations/pages/balance-sheet-report/options-schema";
import { OptionsRow, OptionsGroup } from "@/components/presentations/shared/options-layout";
import { AsOfOptionsGroup } from "../balance-sheet/options-control";

const VIEWS = Object.entries(BALANCE_SHEET_REPORT_VIEWS) as Array<[BalanceSheetReportOptions["view"], string]>;

export function BalanceSheetReportOptionsControl({
  value,
  onChange,
}: {
  value: BalanceSheetReportOptions;
  onChange: (next: BalanceSheetReportOptions) => void;
}) {
  return (
    <OptionsRow>
      <AsOfOptionsGroup value={value} onChange={onChange} />
      <OptionsGroup label="View">
        {VIEWS.map(([view, label]) => (
          <label key={view} className="flex items-center gap-2 hover:text-ink">
            <input
              type="radio"
              className="accent-accent"
              checked={value.view === view}
              onChange={() => onChange({ ...value, view })}
            />
            <span>{label}</span>
          </label>
        ))}
      </OptionsGroup>
    </OptionsRow>
  );
}
