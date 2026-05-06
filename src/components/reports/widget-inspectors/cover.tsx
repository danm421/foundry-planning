// src/components/reports/widget-inspectors/cover.tsx
//
// Inspector body for the cover widget. Drives `onChange` with the next
// props object — the parent `Inspector` dispatches UPDATE_WIDGET_PROPS.

import type { WidgetInspectorProps } from "@/lib/reports/widget-registry";
import { InspectorSection } from "../inspector/section";
import { InspectorTextInput } from "../inspector/text-input";

export function CoverInspector({ props, onChange }: WidgetInspectorProps<"cover">) {
  return (
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
      <InspectorTextInput
        label="Year"
        value={String(props.year ?? "")}
        onChange={(v) =>
          onChange({ ...props, year: v ? Number(v) : undefined })
        }
      />
    </InspectorSection>
  );
}
