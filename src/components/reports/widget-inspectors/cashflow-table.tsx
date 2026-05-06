// src/components/reports/widget-inspectors/cashflow-table.tsx
//
// Inspector body for the cashflowTable widget. Title/subtitle (A),
// year-range + ownership view (B), show-totals toggle (C), and
// advisor-only notes (D). Drives `onChange` with the next props object;
// the parent `Inspector` dispatches UPDATE_WIDGET_PROPS.

import { InspectorSection } from "../inspector/section";
import { InspectorTextInput } from "../inspector/text-input";
import { InspectorSelect } from "../inspector/select";
import { InspectorYearRange } from "../inspector/year-range";
import { InspectorToggle } from "../inspector/toggle";
import { InspectorNotes } from "../inspector/notes";
import type { WidgetInspectorProps } from "@/lib/reports/widget-registry";
import type { OwnershipView } from "@/lib/reports/types";

const OWNERSHIP: readonly { value: OwnershipView; label: string }[] = [
  { value: "consolidated", label: "Consolidated" },
  { value: "client", label: "Client only" },
  { value: "spouse", label: "Spouse only" },
  { value: "joint", label: "Joint only" },
  { value: "entities", label: "Entities only" },
];

export function CashflowTableInspector({
  props,
  onChange,
}: WidgetInspectorProps<"cashflowTable">) {
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
        <InspectorSelect
          label="Ownership view"
          value={props.ownership}
          onChange={(v) => onChange({ ...props, ownership: v })}
          options={OWNERSHIP}
        />
      </InspectorSection>
      <InspectorSection eyebrow="C · Display">
        <InspectorToggle
          label="Show totals"
          value={props.showTotals}
          onChange={(v) => onChange({ ...props, showTotals: v })}
        />
      </InspectorSection>
      <InspectorNotes
        value={props.notes ?? ""}
        onChange={(v) => onChange({ ...props, notes: v })}
      />
    </>
  );
}
