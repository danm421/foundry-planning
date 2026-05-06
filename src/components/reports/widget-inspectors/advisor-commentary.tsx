// src/components/reports/widget-inspectors/advisor-commentary.tsx
//
// Inspector body for the advisorCommentary widget. Optional headline
// text input + multi-line body textarea (rows=6).

import type { WidgetInspectorProps } from "@/lib/reports/widget-registry";
import { InspectorSection } from "../inspector/section";
import { InspectorTextInput } from "../inspector/text-input";
import { InspectorTextarea } from "../inspector/textarea";

export function AdvisorCommentaryInspector({
  props,
  onChange,
}: WidgetInspectorProps<"advisorCommentary">) {
  return (
    <InspectorSection eyebrow="A · Content">
      <InspectorTextInput
        label="Headline (optional)"
        value={props.headline ?? ""}
        onChange={(v) => onChange({ ...props, headline: v || undefined })}
      />
      <InspectorTextarea
        label="Body"
        value={props.body}
        onChange={(v) => onChange({ ...props, body: v })}
        rows={6}
      />
    </InspectorSection>
  );
}
