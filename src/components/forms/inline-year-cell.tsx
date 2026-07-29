"use client";

// The start/end year cell on a details-page row.
//
// An income doesn't just store `startYear: 2035` — it stores `startYearRef`
// too, a milestone anchor. When the ref is set the year is DERIVED: move the
// retirement age and every anchored stream follows. A plain year dropdown
// would quietly convert "ends at Cooper's retirement" into a hardcoded 2035,
// so this cell carries the anchor, not just the number, and renders the anchor
// name in read mode so an anchored row is distinguishable from a hardcoded one.
//
// Custom year is a two-step for the same reason Custom % is on the growth
// cell: a <select> cannot host a number input. Picking it ARMS the editor; the
// write lands on commit.
import { useState } from "react";
import { InlineSelect } from "./inline-select";
import { InlineAmount } from "./inline-amount";
import {
  availableRefs,
  resolveMilestone,
  YEAR_REF_LABELS,
  type ClientMilestones,
  type YearRef,
} from "@/lib/milestones";

export const CUSTOM_YEAR_VALUE = "__custom__";

export interface InlineYearCellProps {
  year: number;
  yearRef: YearRef | null;
  milestones: ClientMilestones;
  /**
   * Drives position-aware resolution: a transition ref used as an END resolves
   * to `year - 1`, so the stream stops the year before the transition rather
   * than overlapping the one that starts there.
   */
  position: "start" | "end";
  /** Social-Security anchors, for SS income rows. */
  showSSRefs?: boolean;
  /** Lowercase noun phrase — "start year for Salary". */
  label: string;
  canEdit: boolean;
  onSave: (year: number, ref: YearRef | null) => Promise<boolean>;
}

export default function InlineYearCell({
  year,
  yearRef,
  milestones,
  position,
  showSSRefs = false,
  label,
  canEdit,
  onSave,
}: InlineYearCellProps) {
  const [customArmed, setCustomArmed] = useState(false);

  const display = yearRef ? `${YEAR_REF_LABELS[yearRef]} (${year})` : String(year);

  if (!canEdit) {
    return <span className="tabular text-[11px] text-ink-3">{display}</span>;
  }

  if (customArmed) {
    return (
      <InlineAmount
        mode="plain"
        noun="year"
        amount={year}
        label={label}
        onSave={async (next) => {
          // ref null is a REAL value here — "manual year, not anchored". It
          // must reach the writer, which is why the flow patch does not strip
          // nulls the way the account patch strips growthRate.
          const ok = await onSave(Math.round(next), null);
          setCustomArmed(false);
          return ok;
        }}
        wrapperClassName="relative w-[64px]"
        className="min-w-[48px] rounded-sm px-1 py-0.5 text-right tabular text-[11px] text-ink-3 hover:bg-card-hover hover:text-ink-2"
      />
    );
  }

  const refs = availableRefs(milestones, showSSRefs, position);

  return (
    <InlineSelect
      display={display}
      value={yearRef ?? CUSTOM_YEAR_VALUE}
      label={label}
      canEdit
      className="rounded-sm px-1 py-0.5 tabular text-[11px] text-ink-3 hover:bg-card-hover hover:text-ink-2"
      options={[
        ...refs.map((r) => ({ ref: r.ref, label: `${r.label} (${r.year})` }))
          .map((r) => ({ value: r.ref, label: r.label })),
        { value: CUSTOM_YEAR_VALUE, label: "Custom year…" },
      ]}
      onSelect={(raw) => {
        if (raw === CUSTOM_YEAR_VALUE) {
          setCustomArmed(true);
          return;
        }
        const ref = raw as YearRef;
        const resolved = resolveMilestone(ref, milestones, position);
        // undefined means the ref needs spouse data this household lacks.
        // `availableRefs` already filters those out, so this is belt-and-braces.
        if (resolved != null) void onSave(resolved, ref);
      }}
    />
  );
}
