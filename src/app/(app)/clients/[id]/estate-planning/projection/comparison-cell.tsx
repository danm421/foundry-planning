"use client";

import MoneyText from "@/components/money-text";
import {
  ScenarioPickerDropdown,
  type ScenarioOption,
  type SnapshotOption,
} from "@/components/scenario/scenario-picker-dropdown";
import { useCompareState } from "@/hooks/use-compare-state";
import {
  formatSignedM,
  type ComparisonCell,
  type RowSentiment,
} from "./lib/derive-scrubber-data";

interface Props {
  cell: ComparisonCell;
  side: "left" | "right" | "delta";
  clientId: string;
  scenarios: ScenarioOption[];
  snapshots: SnapshotOption[];
  /** URL value for the picker on this side; ignored when side === "delta". */
  pickerValue?: string;
}

const VARIANT_BG: Record<Props["side"], string> = {
  left: "bg-card",
  right: "bg-card-2",
  delta: "bg-gradient-to-br from-accent/5 to-accent/15",
};

export function ComparisonCellView({
  cell,
  side,
  clientId,
  scenarios,
  snapshots,
  pickerValue,
}: Props) {
  const { setSide } = useCompareState(clientId);
  const bg = VARIANT_BG[side];
  const headlineColor = cell.variant === "delta" ? "text-accent-ink" : "text-ink";

  return (
    <div className={`p-4 ${bg}`}>
      <div className="mb-2">
        {cell.variant === "plan" && pickerValue !== undefined ? (
          <ScenarioPickerDropdown
            value={pickerValue}
            onChange={(next) => setSide(side as "left" | "right", next)}
            scenarios={scenarios}
            snapshots={snapshots}
            includeDoNothing
            ariaLabel={`${side === "left" ? "Plan 1" : "Plan 2"} scenario`}
          />
        ) : (
          <div className="text-[11px] uppercase tracking-wider text-ink-3">
            {cell.scenarioName}
          </div>
        )}
      </div>
      <div className={`mb-1 text-[13px] font-semibold ${headlineColor}`}>
        {cell.headlineLabel}
      </div>
      {cell.variant === "delta" ? (
        <div className="text-[30px] font-mono tabular-nums">
          {formatSignedM(cell.bigNumber)}
        </div>
      ) : (
        <MoneyText
          value={cell.bigNumber}
          format="currency"
          className="text-[30px] font-mono tabular-nums"
        />
      )}
      <div className="mb-3 text-[11px] text-ink-3">{cell.subLine}</div>
      <ul className="space-y-1 text-[12px]">
        {cell.rows.map((r, i) => (
          <li key={i} className="flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${sentimentColor(r.sentiment)}`}
              aria-hidden="true"
            />
            <span className="flex-1">{r.label}</span>
            <span className="font-mono tabular-nums">{r.valueText}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function sentimentColor(s: RowSentiment): string {
  return { neutral: "bg-ink-3", pos: "bg-accent", neg: "bg-crit" }[s];
}
