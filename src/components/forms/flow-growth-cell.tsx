"use client";

// The growth rate on an Inflows & Outflows row: click-to-open <select> with the
// two options a FLOW can actually store.
//
// Not `GrowthRateCell`, on two independent grounds. Its prop is an `AccountRow`,
// which a flow is not; and `growthEditModeFor` knows only account categories, so
// a flow falls through to `custom_only` and would never be offered `inflation` —
// which incomes and expenses genuinely store (`itemGrowthSourceEnum` is
// `["custom", "inflation"]`, schema.ts). Its `patchFromGrowthSelection` also
// returns the account quartet (`modelPortfolioId` / `tickerPortfolioId`), and
// flows have no column to write those to.
//
// A bare percent editor would be wrong too: committing one on an
// inflation-following flow has to flip `growthSource` to `custom` as well, and a
// control that does that invisibly silently un-follows inflation. Hence the
// two-option select.
//
// Custom % is a two-step for the same reason it is on `GrowthRateCell` and
// `InlineYearCell`: a <select> cannot host a number input. Picking it ARMS the
// percent editor; the write lands on commit, carrying rate AND source together
// so the engine never sees `custom` with a stale rate.
import { useState } from "react";
import { InlineAmount } from "@/components/forms/inline-amount";
import { InlineSelect } from "@/components/forms/inline-select";
import { formatGrowthPct, inflationRateOptionLabel } from "@/lib/inline-edit/growth-options";
import type { FlowPatch } from "@/lib/inline-edit/flow-write";

export interface FlowGrowthCellProps {
  row: {
    name: string;
    growthRate?: string | null;
    /** `itemGrowthSourceEnum` — anything but `"inflation"` reads back as custom. */
    growthSource?: string | null;
  };
  /**
   * The plan's SCENARIO-EFFECTIVE inflation rate, for the "Inflation rate"
   * option's label — same prop, same reason, as `GrowthRateCell`'s: a base-scoped
   * rate would label the option 2.50% on a scenario that inflates at 3.5%.
   */
  resolvedInflationRate: number;
  canEdit: boolean;
  onSave: (patch: FlowPatch) => Promise<boolean>;
}

export default function FlowGrowthCell({
  row,
  resolvedInflationRate,
  canEdit,
  onSave,
}: FlowGrowthCellProps) {
  const [customArmed, setCustomArmed] = useState(false);

  const display = formatGrowthPct(row.growthRate ?? null);

  // Self-handled, like `GrowthRateCell` — so the call site never has to supply a
  // read-only fallback for this slot.
  if (!canEdit) {
    return <span className="tabular text-[11px] text-ink-3">{display}</span>;
  }

  if (customArmed) {
    return (
      <InlineAmount
        mode="percent"
        amount={Number(row.growthRate ?? 0) * 100}
        label={`${row.name} growth rate`}
        onSave={async (nextPct) => {
          const ok = await onSave({
            growthRate: String(nextPct / 100),
            growthSource: "custom",
          });
          setCustomArmed(false);
          return ok;
        }}
        className="min-w-[56px] rounded-sm px-1 py-0.5 text-right tabular text-[11px] text-ink-3 hover:bg-card-hover hover:text-ink-2"
      />
    );
  }

  return (
    <InlineSelect
      display={display}
      // Flows have no `"default"` source, so everything that isn't `inflation`
      // — null included — is `custom`.
      value={row.growthSource === "inflation" ? "inflation" : "custom"}
      label={`growth rate for ${row.name}`}
      canEdit
      className="rounded-sm px-1 py-0.5 tabular text-[11px] text-ink-3 hover:bg-card-hover hover:text-ink-2"
      // Order and wording mirror `growthOptionsFor`'s `inflation_custom` branch,
      // which is the one the full editor renders for the same pair of choices.
      options={[
        { value: "custom", label: "Custom %" },
        { value: "inflation", label: inflationRateOptionLabel(resolvedInflationRate) },
      ]}
      onSelect={(raw) => {
        if (raw === "custom") {
          setCustomArmed(true);
          return;
        }
        // `growthSource` alone. NOT `growthRate: null` — a null growthRate means
        // ABSENCE and reaches the engine as a literal zero, flatlining the row
        // for the whole projection (see flow-write.ts's per-field null rule).
        void onSave({ growthSource: "inflation" });
      }}
    />
  );
}
