// src/components/reports/widget-inspectors/tax-bracket-chart.tsx
//
// Inspector body for the taxBracketChart widget. Title (A), year-range
// (B), showRothBands toggle (C — wired but no-op in v1), advisor notes
// (D).
//
// The Roth-band overlay is intentionally deferred: it requires Roth-
// conversion data plumbed through the cashflow scope so the chart can
// know which dollars are conversion fills vs ordinary income. Logged in
// future-work/reports.md.

import type { WidgetInspectorProps } from "@/lib/reports/widget-registry";
import { InspectorSection } from "../inspector/section";
import { InspectorTextInput } from "../inspector/text-input";
import { InspectorYearRange } from "../inspector/year-range";
import { InspectorToggle } from "../inspector/toggle";
import { InspectorNotes } from "../inspector/notes";

export function TaxBracketChartInspector({
  props,
  onChange,
}: WidgetInspectorProps<"taxBracketChart">) {
  return (
    <>
      <InspectorSection eyebrow="A · Content">
        <InspectorTextInput
          label="Title"
          value={props.title}
          onChange={(v) => onChange({ ...props, title: v })}
        />
        <InspectorTextInput
          label="Subtitle"
          value={props.subtitle ?? ""}
          onChange={(v) => onChange({ ...props, subtitle: v || undefined })}
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
        <InspectorToggle
          label="Show Roth conversion bands"
          value={props.showRothBands}
          onChange={(v) => onChange({ ...props, showRothBands: v })}
        />
        <p className="text-[11px] text-ink-3 italic">
          Coming soon — Roth conversion data not yet wired through the cashflow
          scope.
        </p>
      </InspectorSection>
      <InspectorNotes
        value={props.notes ?? ""}
        onChange={(v) => onChange({ ...props, notes: v })}
      />
    </>
  );
}
