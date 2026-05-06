// src/components/reports/widget-inspectors/section-head.tsx
//
// Inspector body for the sectionHead widget. Drives `onChange` with the
// next props object — the parent `Inspector` dispatches UPDATE_WIDGET_PROPS.

import type { WidgetInspectorProps } from "@/lib/reports/widget-registry";
import { InspectorSection } from "../inspector/section";
import { InspectorTextInput } from "../inspector/text-input";
import { InspectorTextarea } from "../inspector/textarea";

export function SectionHeadInspector({
  props,
  onChange,
}: WidgetInspectorProps<"sectionHead">) {
  return (
    <InspectorSection eyebrow="A · Content">
      <InspectorTextInput
        label="Eyebrow"
        value={props.eyebrow}
        onChange={(v) => onChange({ ...props, eyebrow: v })}
      />
      <InspectorTextInput
        label="Title"
        value={props.title}
        onChange={(v) => onChange({ ...props, title: v })}
      />
      <InspectorTextarea
        label="Intro"
        value={props.intro ?? ""}
        rows={3}
        onChange={(v) => onChange({ ...props, intro: v || undefined })}
      />
    </InspectorSection>
  );
}
