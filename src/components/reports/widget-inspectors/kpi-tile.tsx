// src/components/reports/widget-inspectors/kpi-tile.tsx
//
// Inspector body for the kpiTile widget. Lives in the right pane of the
// builder when a kpiTile is selected. Drives `onChange` with the next
// props object — the parent `Inspector` dispatches UPDATE_WIDGET_PROPS.

import type { WidgetInspectorProps } from "@/lib/reports/widget-registry";
import { listMetrics } from "@/lib/reports/metric-registry";
import { InspectorSection } from "../inspector/section";
import { InspectorTextInput } from "../inspector/text-input";
import { InspectorSelect } from "../inspector/select";
import { InspectorToggle } from "../inspector/toggle";
import { InspectorNotes } from "../inspector/notes";

export function KpiTileInspector({ props, onChange }: WidgetInspectorProps<"kpiTile">) {
  const metricOptions = listMetrics().map((m) => ({ value: m.key, label: m.label }));
  return (
    <>
      <InspectorSection eyebrow="A · Content">
        <InspectorTextInput label="Title override" value={props.titleOverride ?? ""}
          onChange={(v) => onChange({ ...props, titleOverride: v || undefined })} />
        <InspectorTextInput label="Subtitle" value={props.subtitle ?? ""}
          onChange={(v) => onChange({ ...props, subtitle: v || undefined })} />
      </InspectorSection>
      <InspectorSection eyebrow="B · Data">
        <InspectorSelect label="Metric" value={props.metricKey}
          onChange={(v) => onChange({ ...props, metricKey: v })}
          options={metricOptions} />
        <InspectorToggle label="Show delta vs prior year" value={!!props.showDelta}
          onChange={(v) => onChange({ ...props, showDelta: v })} />
      </InspectorSection>
      <InspectorSection eyebrow="C · Style">
        <InspectorSelect<"accent" | "good" | "crit" | "steel">
          label="Accent color"
          value={props.accentColor ?? "accent"}
          onChange={(v) => onChange({ ...props, accentColor: v })}
          options={[
            { value: "accent", label: "Accent (gold)" },
            { value: "good", label: "Good (green)" },
            { value: "crit", label: "Critical (red)" },
            { value: "steel", label: "Steel (blue)" },
          ]} />
      </InspectorSection>
      <InspectorNotes value={props.notes ?? ""} onChange={(v) => onChange({ ...props, notes: v })} />
    </>
  );
}
