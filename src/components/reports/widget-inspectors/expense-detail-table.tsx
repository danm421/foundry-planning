// src/components/reports/widget-inspectors/expense-detail-table.tsx
//
// Inspector body for the expenseDetailTable widget. Title (A),
// year-range (B), groupByCategory toggle (C — disabled in v1 with a
// "coming soon" tooltip), advisor notes (D).
//
// The disabled toggle is a deliberate inspector affordance: the prop
// shape ships now so v1 reports can be persisted and round-tripped, but
// the underlying engine work (per-category expense attribution) is
// pending — see future-work/reports.md.

import type { WidgetInspectorProps } from "@/lib/reports/widget-registry";
import { InspectorSection } from "../inspector/section";
import { InspectorTextInput } from "../inspector/text-input";
import { InspectorYearRange } from "../inspector/year-range";
import { InspectorNotes } from "../inspector/notes";

export function ExpenseDetailTableInspector({
  props,
  onChange,
}: WidgetInspectorProps<"expenseDetailTable">) {
  return (
    <>
      <InspectorSection eyebrow="A · Content">
        <InspectorTextInput
          label="Title"
          value={props.title ?? ""}
          onChange={(v) => onChange({ ...props, title: v || undefined })}
        />
      </InspectorSection>
      <InspectorSection eyebrow="B · Data">
        <InspectorYearRange
          label="Year range"
          value={props.yearRange}
          onChange={(v) => onChange({ ...props, yearRange: v })}
        />
      </InspectorSection>
      <InspectorSection eyebrow="C · Display">
        <div
          className="flex items-center justify-between text-[13px] text-ink-3 opacity-60 cursor-not-allowed"
          title="Coming soon — pending engine category-attribution work"
        >
          <span>Group by category</span>
          <div
            aria-disabled="true"
            className="relative h-5 w-9 rounded-full bg-card-2 border border-hair"
          >
            <span className="absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-paper" />
          </div>
        </div>
        <p className="text-[11px] text-ink-3 italic">
          Coming soon — requires per-category expense attribution.
        </p>
      </InspectorSection>
      <InspectorNotes
        value={props.notes ?? ""}
        onChange={(v) => onChange({ ...props, notes: v })}
      />
    </>
  );
}
