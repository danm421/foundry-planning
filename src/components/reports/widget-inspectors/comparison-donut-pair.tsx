// src/components/reports/widget-inspectors/comparison-donut-pair.tsx
//
// Inspector body for the comparisonDonutPair widget. Title/subtitle (A),
// asOfYear (B — text input accepting "current" or YYYY, mirroring the
// allocationDonut inspector), legend toggle (C), advisor-only notes (D).
//
// `asOfYear` is wired but a no-op visually in v1 — the underlying
// allocation scope only exposes the first-year breakdown. Symmetric with
// the single-side allocationDonut inspector.

import { InspectorSection } from "../inspector/section";
import { InspectorTextInput } from "../inspector/text-input";
import { InspectorToggle } from "../inspector/toggle";
import { InspectorNotes } from "../inspector/notes";
import type { WidgetInspectorProps } from "@/lib/reports/widget-registry";

function asOfYearToString(v: number | "current"): string {
  return v === "current" ? "current" : String(v);
}

function parseAsOfYear(v: string): number | "current" {
  const trimmed = v.trim().toLowerCase();
  if (trimmed === "" || trimmed === "current") return "current";
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : "current";
}

export function ComparisonDonutPairInspector({
  props,
  onChange,
}: WidgetInspectorProps<"comparisonDonutPair">) {
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
        <InspectorTextInput
          label='As-of year ("current" or YYYY)'
          value={asOfYearToString(props.asOfYear)}
          onChange={(v) => onChange({ ...props, asOfYear: parseAsOfYear(v) })}
        />
      </InspectorSection>
      <InspectorSection eyebrow="C · Display">
        <InspectorToggle
          label="Show legend"
          value={props.showLegend}
          onChange={(v) => onChange({ ...props, showLegend: v })}
        />
      </InspectorSection>
      <InspectorNotes
        value={props.notes ?? ""}
        onChange={(v) => onChange({ ...props, notes: v })}
      />
    </>
  );
}
