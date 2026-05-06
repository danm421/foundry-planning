// src/components/reports/widget-inspectors/allocation-donut.tsx
//
// Inspector body for the allocationDonut widget. A·Content (title +
// subtitle), B·Data (asOfYear), C·Display (innerRingAssetType + showLegend),
// D·Notes.
//
// `innerRingAssetType` is wired but no-op visually in v1 — the engine
// doesn't expose asset-type rollups at the year level. The toggle label
// reflects this so users don't expect a second ring to appear. See
// allocation-donut.tsx (screen) for the full deferral note.
//
// asOfYear is rendered as a text input that accepts the literal "current"
// or a numeric year — same minimal pattern as balance-sheet-table's
// inspector (see header note there for the rationale).

import { InspectorSection } from "../inspector/section";
import { InspectorTextInput } from "../inspector/text-input";
import { InspectorToggle } from "../inspector/toggle";
import { InspectorNotes } from "../inspector/notes";
import type { WidgetInspectorProps } from "@/lib/reports/widget-registry";

function asOfYearToString(v: number | "current"): string {
  return v === "current" ? "current" : String(v);
}

function parseAsOfYear(v: string): number | "current" {
  const trimmed = v.trim().toLowerCase();
  if (trimmed === "" || trimmed === "current") return "current";
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : "current";
}

export function AllocationDonutInspector({
  props,
  onChange,
}: WidgetInspectorProps<"allocationDonut">) {
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
        <InspectorTextInput
          label='As-of year ("current" or YYYY)'
          value={asOfYearToString(props.asOfYear)}
          onChange={(v) => onChange({ ...props, asOfYear: parseAsOfYear(v) })}
        />
      </InspectorSection>
      <InspectorSection eyebrow="C · Display">
        <InspectorToggle
          label="Inner ring (asset type) — coming soon"
          value={props.innerRingAssetType}
          onChange={(v) => onChange({ ...props, innerRingAssetType: v })}
        />
        <InspectorToggle
          label="Show legend"
          value={props.showLegend}
          onChange={(v) => onChange({ ...props, showLegend: v })}
        />
      </InspectorSection>
      <InspectorNotes
        value={props.notes ?? ""}
        onChange={(v) => onChange({ ...props, notes: v })}
      />
    </>
  );
}
