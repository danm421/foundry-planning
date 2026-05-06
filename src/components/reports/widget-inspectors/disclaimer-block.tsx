// src/components/reports/widget-inspectors/disclaimer-block.tsx
//
// Inspector body for the disclaimerBlock widget. A single multi-line
// body textarea (rows=8 — disclaimers run long).

import type { WidgetInspectorProps } from "@/lib/reports/widget-registry";
import { InspectorSection } from "../inspector/section";
import { InspectorTextarea } from "../inspector/textarea";
import { InspectorNotes } from "../inspector/notes";

export function DisclaimerBlockInspector({
  props,
  onChange,
}: WidgetInspectorProps<"disclaimerBlock">) {
  return (
    <>
      <InspectorSection eyebrow="A · Content">
        <InspectorTextarea
          label="Body"
          value={props.body}
          onChange={(v) => onChange({ ...props, body: v })}
          rows={8}
        />
      </InspectorSection>
      <InspectorNotes
        value={props.notes ?? ""}
        onChange={(v) => onChange({ ...props, notes: v })}
      />
    </>
  );
}
