"use client";

// The start/end year cell on a details-page row.
//
// An income doesn't just store `startYear: 2035` — it stores `startYearRef`
// too, a milestone anchor. When the ref is set the year is DERIVED: move the
// retirement age and every anchored stream follows. A plain year dropdown
// would quietly convert "ends at Cooper's retirement" into a hardcoded 2035,
// so this cell carries the anchor, not just the number.
//
// Read mode shows the YEAR ALONE. The anchor name used to sit beside it
// ("Client Retirement (2035)"), which wrapped to three lines inside a row cell
// and starved the row's name column down to four characters — the flow's name
// is the one thing an advisor scans for, and it was the one thing they could
// not read. The anchor survives as a dotted underline (anchored vs hardcoded,
// at a glance) plus a tooltip that names it. Same treatment the Household Map's
// cash-flow board already gives its timing cell.
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

  const anchorName = yearRef ? YEAR_REF_LABELS[yearRef] : null;
  // The dotted underline is the whole anchored/hardcoded signal now, so it has
  // to ride along on every read-mode branch below.
  const anchorMark = anchorName
    ? " underline decoration-dotted decoration-ink-4 underline-offset-[3px]"
    : "";

  if (!canEdit) {
    return (
      <span title={anchorName ?? undefined} className={`tabular text-[11px] text-ink-3${anchorMark}`}>
        {year}
      </span>
    );
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
        // Sized to a four-digit year, and kept in step with the row cell that
        // hosts it (`income-expenses/row.tsx`) so arming the editor doesn't
        // widen the column and shove the flow's name.
        wrapperClassName="relative w-[52px]"
        className="min-w-[44px] rounded-sm px-1 py-0.5 text-right tabular text-[11px] text-ink-3 hover:bg-card-hover hover:text-ink-2"
      />
    );
  }

  const refs = availableRefs(milestones, showSSRefs, position);

  return (
    <InlineSelect
      display={String(year)}
      title={anchorName ?? undefined}
      value={yearRef ?? CUSTOM_YEAR_VALUE}
      label={label}
      canEdit
      className={`rounded-sm px-1 py-0.5 tabular text-[11px] text-ink-3 hover:bg-card-hover hover:text-ink-2${anchorMark}`}
      options={[
        ...refs.map((r) => ({ value: r.ref, label: `${r.label} (${r.year})` })),
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
