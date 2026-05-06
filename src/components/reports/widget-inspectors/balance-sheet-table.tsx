// src/components/reports/widget-inspectors/balance-sheet-table.tsx
//
// Inspector body for the balanceSheetTable widget. A·Content (title +
// subtitle), B·Data (asOfYear + ownership view), C·Display (entity
// breakdown toggle — wired but no-op visually in v1; the screen render
// shows category totals + nets only), D·Notes.
//
// asOfYear is rendered as a text input that accepts the literal "current"
// or a numeric year. Kept simple deliberately: the year list is unbounded
// (engine projection runs to plan-end-age, varies per household), and a
// dedicated control adds inspector complexity disproportionate to the v1
// payoff. Future work: replace with an InspectorSelect populated from the
// builder's projection range — see future-work/reports.md.

import { InspectorSection } from "../inspector/section";
import { InspectorTextInput } from "../inspector/text-input";
import { InspectorSelect } from "../inspector/select";
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

function asOfYearToString(v: number | "current"): string {
  return v === "current" ? "current" : String(v);
}

function parseAsOfYear(v: string): number | "current" {
  const trimmed = v.trim().toLowerCase();
  if (trimmed === "" || trimmed === "current") return "current";
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : "current";
}

export function BalanceSheetTableInspector({
  props,
  onChange,
}: WidgetInspectorProps<"balanceSheetTable">) {
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
        <InspectorSelect
          label="Ownership view"
          value={props.ownership}
          onChange={(v) => onChange({ ...props, ownership: v })}
          options={OWNERSHIP}
        />
      </InspectorSection>
      <InspectorSection eyebrow="C · Display">
        <InspectorToggle
          label="Show entity breakdown"
          value={props.showEntityBreakdown}
          onChange={(v) => onChange({ ...props, showEntityBreakdown: v })}
        />
      </InspectorSection>
      <InspectorNotes
        value={props.notes ?? ""}
        onChange={(v) => onChange({ ...props, notes: v })}
      />
    </>
  );
}
