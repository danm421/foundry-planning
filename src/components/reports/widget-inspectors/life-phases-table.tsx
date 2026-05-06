// src/components/reports/widget-inspectors/life-phases-table.tsx
//
// Inspector body for the lifePhasesTable widget. Title (A) + an editable
// rows table (B) where each row has phase / years / ages text inputs and
// a remove button. An "+ Add row" button appends a fresh blank row.

import type { WidgetInspectorProps } from "@/lib/reports/widget-registry";
import type { LifePhasesTableProps } from "@/lib/reports/types";
import { InspectorSection } from "../inspector/section";
import { InspectorTextInput } from "../inspector/text-input";
import { InspectorNotes } from "../inspector/notes";
import { inputClassName, fieldLabelClassName } from "@/components/forms/input-styles";

type Row = LifePhasesTableProps["rows"][number];

function blankRow(): Row {
  return { phase: "", years: "", ages: "" };
}

export function LifePhasesTableInspector({
  props,
  onChange,
}: WidgetInspectorProps<"lifePhasesTable">) {
  const updateRow = (index: number, patch: Partial<Row>) => {
    const next = props.rows.map((r, i) => (i === index ? { ...r, ...patch } : r));
    onChange({ ...props, rows: next });
  };
  const removeRow = (index: number) => {
    onChange({ ...props, rows: props.rows.filter((_, i) => i !== index) });
  };
  const addRow = () => {
    onChange({ ...props, rows: [...props.rows, blankRow()] });
  };

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
        <div className="space-y-3">
          {props.rows.map((r, i) => (
            <div
              key={i}
              className="rounded-sm border border-hair p-3 space-y-2 bg-card-2"
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono uppercase tracking-wider text-ink-3">
                  Row {i + 1}
                </span>
                <button
                  type="button"
                  onClick={() => removeRow(i)}
                  className="text-[11px] font-mono text-crit hover:opacity-80"
                >
                  remove
                </button>
              </div>
              <div>
                <label className={fieldLabelClassName}>Phase</label>
                <input
                  className={inputClassName}
                  value={r.phase}
                  onChange={(e) => updateRow(i, { phase: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={fieldLabelClassName}>Years</label>
                  <input
                    className={inputClassName}
                    value={r.years}
                    onChange={(e) => updateRow(i, { years: e.target.value })}
                  />
                </div>
                <div>
                  <label className={fieldLabelClassName}>Ages</label>
                  <input
                    className={inputClassName}
                    value={r.ages}
                    onChange={(e) => updateRow(i, { ages: e.target.value })}
                  />
                </div>
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={addRow}
            className="w-full h-8 text-[12px] font-mono text-ink-3 border border-dashed border-hair rounded-sm hover:text-ink hover:border-ink-3 transition"
          >
            + Add row
          </button>
        </div>
      </InspectorSection>
      <InspectorNotes
        value={props.notes ?? ""}
        onChange={(v) => onChange({ ...props, notes: v })}
      />
    </>
  );
}
