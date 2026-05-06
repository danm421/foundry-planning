// src/components/reports/widget-inspectors/income-sources-area.tsx
//
// Inspector body for the incomeSourcesArea widget. Title/subtitle (A),
// year range (B), series multi-pick (C), and advisor-only notes (D).
// Drives `onChange` with the next props object; the parent `Inspector`
// dispatches UPDATE_WIDGET_PROPS.

import { InspectorSection } from "../inspector/section";
import { InspectorTextInput } from "../inspector/text-input";
import { InspectorYearRange } from "../inspector/year-range";
import { InspectorPillMulti } from "../inspector/pill-multi";
import { InspectorNotes } from "../inspector/notes";
import type { WidgetInspectorProps } from "@/lib/reports/widget-registry";
import type { IncomeSourcesSeries } from "@/lib/reports/types";

const SERIES_OPTIONS: readonly { value: IncomeSourcesSeries; label: string }[] = [
  { value: "wages", label: "Wages" },
  { value: "socialSecurity", label: "Social Security" },
  { value: "pensions", label: "Pensions" },
  { value: "withdrawals", label: "Withdrawals" },
  { value: "other", label: "Other" },
];

export function IncomeSourcesAreaInspector({
  props,
  onChange,
}: WidgetInspectorProps<"incomeSourcesArea">) {
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
        <InspectorYearRange
          label="Year range"
          value={props.yearRange}
          onChange={(v) => onChange({ ...props, yearRange: v })}
        />
      </InspectorSection>
      <InspectorSection eyebrow="C · Display">
        <InspectorPillMulti<IncomeSourcesSeries>
          label="Series"
          value={props.series}
          onChange={(v) => onChange({ ...props, series: v })}
          options={SERIES_OPTIONS}
        />
      </InspectorSection>
      <InspectorNotes
        value={props.notes ?? ""}
        onChange={(v) => onChange({ ...props, notes: v })}
      />
    </>
  );
}
