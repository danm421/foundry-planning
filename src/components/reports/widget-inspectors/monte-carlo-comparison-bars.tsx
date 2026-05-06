// src/components/reports/widget-inspectors/monte-carlo-comparison-bars.tsx
//
// Inspector body for the monteCarloComparisonBars widget. Title/subtitle
// (A) and advisor-only notes (B). The widget reads probability values
// straight from `comparison.delta.successProbability` — no display knobs
// to expose for v1.

import { InspectorSection } from "../inspector/section";
import { InspectorTextInput } from "../inspector/text-input";
import { InspectorNotes } from "../inspector/notes";
import type { WidgetInspectorProps } from "@/lib/reports/widget-registry";

export function MonteCarloComparisonBarsInspector({
  props,
  onChange,
}: WidgetInspectorProps<"monteCarloComparisonBars">) {
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
      <InspectorNotes
        value={props.notes ?? ""}
        onChange={(v) => onChange({ ...props, notes: v })}
      />
    </>
  );
}
