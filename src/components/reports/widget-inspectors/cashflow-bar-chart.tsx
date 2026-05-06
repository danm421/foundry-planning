// src/components/reports/widget-inspectors/cashflow-bar-chart.tsx
//
// Inspector body for the cashflowBarChart widget. Title/subtitle (A),
// year-range + ownership view (B), stacking + legend + grid (C), and
// advisor-only notes (D). Drives `onChange` with the next props object;
// the parent `Inspector` dispatches UPDATE_WIDGET_PROPS.

import { InspectorSection } from "../inspector/section";
import { InspectorTextInput } from "../inspector/text-input";
import { InspectorSelect } from "../inspector/select";
import { InspectorYearRange } from "../inspector/year-range";
import { InspectorPillSingle } from "../inspector/pill-single";
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

const STACKING: readonly { value: "stacked" | "grouped"; label: string }[] = [
  { value: "stacked", label: "Stacked" },
  { value: "grouped", label: "Grouped" },
];

export function CashflowBarChartInspector({
  props,
  onChange,
}: WidgetInspectorProps<"cashflowBarChart">) {
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
      <InspectorSection eyebrow="C · Display">
        <InspectorPillSingle
          label="Stacking"
          value={props.stacking}
          onChange={(v) => onChange({ ...props, stacking: v })}
          options={STACKING}
        />
        <InspectorToggle
          label="Show legend"
          value={props.showLegend}
          onChange={(v) => onChange({ ...props, showLegend: v })}
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
