// src/components/reports/widget-inspectors/risk-table.tsx
//
// Inspector body for the riskTable widget. A·Content (title), B·Rows
// (editable list of risks with area / description / severity, plus
// add/remove), D·Notes.
//
// Mirrors the editable-rows pattern from the recommendedChangesTable
// inspector — bordered card per row with a "Remove" affordance and an
// "Add row" button below.

import type { WidgetInspectorProps } from "@/lib/reports/widget-registry";
import type { RiskSeverity, RiskTableProps } from "@/lib/reports/types";
import { InspectorSection } from "../inspector/section";
import { InspectorTextInput } from "../inspector/text-input";
import { InspectorNotes } from "../inspector/notes";
import {
  inputClassName,
  selectClassName,
  fieldLabelClassName,
} from "@/components/forms/input-styles";

const SEVERITY_OPTIONS: readonly { value: RiskSeverity; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

export function RiskTableInspector({
  props,
  onChange,
}: WidgetInspectorProps<"riskTable">) {
  function updateRow(
    index: number,
    patch: Partial<RiskTableProps["rows"][number]>,
  ) {
    const rows = props.rows.map((r, i) => (i === index ? { ...r, ...patch } : r));
    onChange({ ...props, rows });
  }

  function addRow() {
    onChange({
      ...props,
      rows: [...props.rows, { area: "", description: "", severity: "medium" }],
    });
  }

  function removeRow(index: number) {
    onChange({
      ...props,
      rows: props.rows.filter((_, i) => i !== index),
    });
  }

  return (
    <>
      <InspectorSection eyebrow="A · Content">
        <InspectorTextInput
          label="Title"
          value={props.title ?? ""}
          onChange={(v) => onChange({ ...props, title: v || undefined })}
        />
      </InspectorSection>
      <InspectorSection eyebrow="B · Rows">
        {props.rows.length === 0 ? (
          <div className="text-[12px] text-ink-3 italic">
            No rows yet. Add one below.
          </div>
        ) : (
          <div className="space-y-3">
            {props.rows.map((row, i) => (
              <div
                key={i}
                className="rounded-[var(--radius-sm)] border border-hair p-3 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <div className="text-[10px] font-mono uppercase tracking-wider text-ink-3">
                    Row {i + 1}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeRow(i)}
                    className="text-[11px] text-ink-3 hover:text-crit underline-offset-2 hover:underline"
                  >
                    Remove
                  </button>
                </div>
                <div>
                  <label className={fieldLabelClassName}>Risk area</label>
                  <input
                    className={inputClassName}
                    value={row.area}
                    onChange={(e) => updateRow(i, { area: e.target.value })}
                  />
                </div>
                <div>
                  <label className={fieldLabelClassName}>Description</label>
                  <input
                    className={inputClassName}
                    value={row.description}
                    onChange={(e) =>
                      updateRow(i, { description: e.target.value })
                    }
                  />
                </div>
                <div>
                  <label className={fieldLabelClassName}>Severity</label>
                  <select
                    className={selectClassName}
                    value={row.severity}
                    onChange={(e) =>
                      updateRow(i, {
                        severity: e.target.value as RiskSeverity,
                      })
                    }
                  >
                    {SEVERITY_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={addRow}
          className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-accent hover:underline"
        >
          + Add row
        </button>
      </InspectorSection>
      <InspectorNotes
        value={props.notes ?? ""}
        onChange={(v) => onChange({ ...props, notes: v || undefined })}
      />
    </>
  );
}
