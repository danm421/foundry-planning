// src/components/reports/widget-inspectors/status-callout.tsx
//
// Inspector body for the statusCallout widget. A·Content (status select
// + headline + body), D·Notes.

import type { WidgetInspectorProps } from "@/lib/reports/widget-registry";
import type { StatusCalloutProps } from "@/lib/reports/types";
import { InspectorSection } from "../inspector/section";
import { InspectorTextInput } from "../inspector/text-input";
import { InspectorTextarea } from "../inspector/textarea";
import { InspectorSelect } from "../inspector/select";
import { InspectorNotes } from "../inspector/notes";

const STATUS_OPTIONS: readonly {
  value: StatusCalloutProps["status"];
  label: string;
}[] = [
  { value: "go", label: "Go (green)" },
  { value: "warn", label: "Warn (amber)" },
  { value: "risk", label: "Risk (red)" },
];

export function StatusCalloutInspector({
  props,
  onChange,
}: WidgetInspectorProps<"statusCallout">) {
  return (
    <>
      <InspectorSection eyebrow="A · Content">
        <InspectorSelect
          label="Status"
          value={props.status}
          onChange={(v) => onChange({ ...props, status: v })}
          options={STATUS_OPTIONS}
        />
        <InspectorTextInput
          label="Headline (optional)"
          value={props.headline ?? ""}
          onChange={(v) => onChange({ ...props, headline: v || undefined })}
        />
        <InspectorTextarea
          label="Body"
          value={props.body}
          onChange={(v) => onChange({ ...props, body: v })}
          rows={4}
        />
      </InspectorSection>
      <InspectorNotes
        value={props.notes ?? ""}
        onChange={(v) => onChange({ ...props, notes: v || undefined })}
      />
    </>
  );
}
