// src/components/reports/widget-inspectors/net-worth-line.tsx
//
// Inspector body for the netWorthLine widget. Title/subtitle (A),
// year-range + ownership view (B), scenario-compare placeholder (C, v1
// stub — see note), markers + grid display toggles (D), and advisor-only
// notes (E). Drives `onChange` with the next props object; the parent
// `Inspector` dispatches UPDATE_WIDGET_PROPS.
//
// Section C is intentionally a static "coming soon" line rather than a
// disabled select. v1 has no scenario records to populate the dropdown
// from, and a single-option select reads as broken UI. The
// `compareScenarioId` prop stays in the schema (defaulted to `null`) so
// the persisted shape is forward-compatible when scenarios ship.

import { InspectorSection } from "../inspector/section";
import { InspectorTextInput } from "../inspector/text-input";
import { InspectorSelect } from "../inspector/select";
import { InspectorYearRange } from "../inspector/year-range";
import { InspectorToggle } from "../inspector/toggle";
import { InspectorNotes } from "../inspector/notes";
import type { WidgetInspectorProps } from "@/lib/reports/widget-registry";
import type { OwnershipView } from "@/lib/reports/types";

const OWNERSHIP: readonly { value: OwnershipView; label: string }[] = [
  { value: "consolidated", label: "Consolidated" },
  { value: "client", label: "Client only" },
  { value: "spouse", label: "Spouse only" },
  { value: "joint", label: "Joint only" },
  { value: "entities", label: "Entities only" },
];

export function NetWorthLineInspector({
  props,
  onChange,
}: WidgetInspectorProps<"netWorthLine">) {
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
        <InspectorSelect
          label="Ownership view"
          value={props.ownership}
          onChange={(v) => onChange({ ...props, ownership: v })}
          options={OWNERSHIP}
        />
      </InspectorSection>
      <InspectorSection eyebrow="C · Compare">
        <div className="text-ink-3 text-[12px]">
          Scenario comparison coming soon.
        </div>
      </InspectorSection>
      <InspectorSection eyebrow="D · Display">
        <InspectorToggle
          label="Show markers"
          value={props.showMarkers}
          onChange={(v) => onChange({ ...props, showMarkers: v })}
        />
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
