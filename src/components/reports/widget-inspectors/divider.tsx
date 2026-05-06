// src/components/reports/widget-inspectors/divider.tsx
//
// Inspector body for the divider widget. The widget exposes a single
// `variant` prop (`hair` | `accent`) that toggles between a subtle
// hairline rule and a 1.5pt accent rule.

import type { WidgetInspectorProps } from "@/lib/reports/widget-registry";
import { InspectorSection } from "../inspector/section";
import { InspectorPillSingle } from "../inspector/pill-single";

const VARIANT_OPTIONS = [
  { value: "hair", label: "Hair" },
  { value: "accent", label: "Accent" },
] as const;

export function DividerInspector({
  props,
  onChange,
}: WidgetInspectorProps<"divider">) {
  return (
    <InspectorSection eyebrow="A · Style">
      <InspectorPillSingle
        label="Variant"
        value={props.variant ?? "hair"}
        onChange={(v) => onChange({ ...props, variant: v })}
        options={VARIANT_OPTIONS}
      />
    </InspectorSection>
  );
}
