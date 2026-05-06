// src/components/reports/widget-inspectors/portfolio-comparison-line.tsx
//
// Inspector body for the portfolioComparisonLine widget. Title/subtitle (A),
// year-range (B), grid toggle (C), advisor-only notes (D).

import { InspectorSection } from "../inspector/section";
import { InspectorTextInput } from "../inspector/text-input";
import { InspectorYearRange } from "../inspector/year-range";
import { InspectorToggle } from "../inspector/toggle";
import { InspectorNotes } from "../inspector/notes";
import type { WidgetInspectorProps } from "@/lib/reports/widget-registry";

export function PortfolioComparisonLineInspector({
  props,
  onChange,
}: WidgetInspectorProps<"portfolioComparisonLine">) {
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
          label="Show grid"
          value={props.showGrid}
          onChange={(v) => onChange({ ...props, showGrid: v })}
        />
      </InspectorSection>
      <InspectorNotes
        value={props.notes ?? ""}
        onChange={(v) => onChange({ ...props, notes: v })}
      />
    </>
  );
}
