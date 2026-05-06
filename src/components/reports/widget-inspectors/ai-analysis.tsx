// src/components/reports/widget-inspectors/ai-analysis.tsx
//
// Inspector body for the aiAnalysis widget. Title (A · Content), scope
// multi-pick (B · Data), tone + length segmented controls (C · Style),
// and advisor-only notes (D · Notes).
//
// v1 SCOPING DECISION: The inspector intentionally does NOT expose a
// Generate button. `WidgetInspectorProps` only carries `props` and
// `onChange` — the inspector pane has no `widgetId` to thread into the
// API call or the dispatched window event. Threading widgetId in would
// require a registry-contract change that's out of scope for v1. Users
// hit Generate / Regenerate from the canvas-side render of the widget
// itself.

import { InspectorSection } from "../inspector/section";
import { InspectorTextInput } from "../inspector/text-input";
import { InspectorPillMulti } from "../inspector/pill-multi";
import { InspectorSegmented } from "../inspector/segmented";
import { InspectorNotes } from "../inspector/notes";
import type { WidgetInspectorProps } from "@/lib/reports/widget-registry";
import type { AiScope, AiTone, AiLength } from "@/lib/reports/types";

const SCOPE_OPTIONS: readonly { value: AiScope; label: string }[] = [
  { value: "cashflow", label: "Cashflow" },
  { value: "balance", label: "Balance" },
  { value: "monteCarlo", label: "Monte Carlo" },
  { value: "tax", label: "Tax" },
  { value: "estate", label: "Estate" },
];

const TONE_OPTIONS: readonly { value: AiTone; label: string }[] = [
  { value: "concise", label: "Concise" },
  { value: "detailed", label: "Detailed" },
  { value: "plain", label: "Plain" },
];

const LENGTH_OPTIONS: readonly { value: AiLength; label: string }[] = [
  { value: "short", label: "Short" },
  { value: "medium", label: "Medium" },
  { value: "long", label: "Long" },
];

export function AiAnalysisInspector({
  props,
  onChange,
}: WidgetInspectorProps<"aiAnalysis">) {
  return (
    <>
      <InspectorSection eyebrow="A · Content">
        <InspectorTextInput
          label="Title (optional)"
          value={props.title ?? ""}
          onChange={(v) => onChange({ ...props, title: v || undefined })}
        />
      </InspectorSection>
      <InspectorSection eyebrow="B · Data">
        <InspectorPillMulti<AiScope>
          label="Scopes"
          value={props.scopes}
          onChange={(v) => onChange({ ...props, scopes: v })}
          options={SCOPE_OPTIONS}
        />
      </InspectorSection>
      <InspectorSection eyebrow="C · Style">
        <InspectorSegmented<AiTone>
          label="Tone"
          value={props.tone}
          onChange={(v) => onChange({ ...props, tone: v })}
          options={TONE_OPTIONS}
        />
        <InspectorSegmented<AiLength>
          label="Length"
          value={props.length}
          onChange={(v) => onChange({ ...props, length: v })}
          options={LENGTH_OPTIONS}
        />
      </InspectorSection>
      <InspectorNotes
        value={props.notes ?? ""}
        onChange={(v) => onChange({ ...props, notes: v })}
      />
    </>
  );
}
