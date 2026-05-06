// src/components/reports/widget-inspectors/recommended-changes-table.tsx
//
// Inspector body for the recommendedChangesTable widget. A·Content
// (title + variant), B·Rows (editable list with add/remove), D·Notes.
//
// The "current"/"proposed" inputs are only shown when variant is
// `currentVsProposed`; in `list` mode the row is just a single "change"
// input. Either way, advisors edit the rows directly here — no engine
// data is consumed.

import type { WidgetInspectorProps } from "@/lib/reports/widget-registry";
import type { RecommendedChangesTableProps } from "@/lib/reports/types";
import { InspectorSection } from "../inspector/section";
import { InspectorTextInput } from "../inspector/text-input";
import { InspectorSelect } from "../inspector/select";
import { InspectorNotes } from "../inspector/notes";
import { inputClassName, fieldLabelClassName } from "@/components/forms/input-styles";

const VARIANT_OPTIONS: readonly {
  value: RecommendedChangesTableProps["variant"];
  label: string;
}[] = [
  { value: "list", label: "List (single column)" },
  { value: "currentVsProposed", label: "Current vs proposed (3 columns)" },
];

export function RecommendedChangesTableInspector({
  props,
  onChange,
}: WidgetInspectorProps<"recommendedChangesTable">) {
  const isCurrentVsProposed = props.variant === "currentVsProposed";

  function updateRow(
    index: number,
    patch: Partial<RecommendedChangesTableProps["rows"][number]>,
  ) {
    const rows = props.rows.map((r, i) => (i === index ? { ...r, ...patch } : r));
    onChange({ ...props, rows });
  }

  function addRow() {
    onChange({
      ...props,
      rows: [...props.rows, { change: "" }],
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
        <InspectorSelect
          label="Variant"
          value={props.variant}
          onChange={(v) => onChange({ ...props, variant: v })}
          options={VARIANT_OPTIONS}
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
                  <label className={fieldLabelClassName}>Change</label>
                  <input
                    className={inputClassName}
                    value={row.change}
                    onChange={(e) => updateRow(i, { change: e.target.value })}
                  />
                </div>
                {isCurrentVsProposed && (
                  <>
                    <div>
                      <label className={fieldLabelClassName}>Current</label>
                      <input
                        className={inputClassName}
                        value={row.current ?? ""}
                        onChange={(e) =>
                          updateRow(i, { current: e.target.value || undefined })
                        }
                      />
                    </div>
                    <div>
                      <label className={fieldLabelClassName}>Proposed</label>
                      <input
                        className={inputClassName}
                        value={row.proposed ?? ""}
                        onChange={(e) =>
                          updateRow(i, { proposed: e.target.value || undefined })
                        }
                      />
                    </div>
                  </>
                )}
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
