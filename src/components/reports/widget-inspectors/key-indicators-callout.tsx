// src/components/reports/widget-inspectors/key-indicators-callout.tsx
//
// Inspector body for the keyIndicatorsCallout widget. A·Content
// (optional title), B·Bullets (textarea — one bullet per line),
// D·Notes.
//
// Bullets are persisted as a string[]; the inspector serializes them as
// newline-joined text for editing convenience and splits/trims on each
// keystroke to keep the widget's prop shape canonical.

import type { WidgetInspectorProps } from "@/lib/reports/widget-registry";
import { InspectorSection } from "../inspector/section";
import { InspectorTextInput } from "../inspector/text-input";
import { InspectorTextarea } from "../inspector/textarea";
import { InspectorNotes } from "../inspector/notes";

function bulletsToText(bullets: string[]): string {
  return bullets.join("\n");
}

function textToBullets(text: string): string[] {
  // Preserve empty lines while typing (so the textarea can hold a trailing
  // newline mid-edit). Renderers skip empty bullets at display time so the
  // rendered list never has gaps.
  return text.split("\n");
}

export function KeyIndicatorsCalloutInspector({
  props,
  onChange,
}: WidgetInspectorProps<"keyIndicatorsCallout">) {
  return (
    <>
      <InspectorSection eyebrow="A · Content">
        <InspectorTextInput
          label="Title (optional)"
          value={props.title ?? ""}
          onChange={(v) => onChange({ ...props, title: v || undefined })}
        />
      </InspectorSection>
      <InspectorSection eyebrow="B · Bullets (one per line)">
        <InspectorTextarea
          label=""
          value={bulletsToText(props.bullets)}
          onChange={(v) => onChange({ ...props, bullets: textToBullets(v) })}
          rows={6}
        />
      </InspectorSection>
      <InspectorNotes
        value={props.notes ?? ""}
        onChange={(v) => onChange({ ...props, notes: v || undefined })}
      />
    </>
  );
}
