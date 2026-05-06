// src/components/reports/widget-inspectors/policies-table.tsx
//
// Inspector body for the policiesTable widget. A·Content (title +
// emptyStateMessage textarea — the message shown when no rows are
// present), B·Rows (editable list with type / owner / death benefit /
// annual premium, plus add/remove), D·Notes.
//
// Numeric inputs use `inputMode="numeric"` and a tolerant parser so
// authors can type commas or dollar signs without breaking the
// downstream `Intl.NumberFormat` render.

import type { WidgetInspectorProps } from "@/lib/reports/widget-registry";
import type { PoliciesTableProps } from "@/lib/reports/types";
import { InspectorSection } from "../inspector/section";
import { InspectorTextInput } from "../inspector/text-input";
import { InspectorTextarea } from "../inspector/textarea";
import { InspectorNotes } from "../inspector/notes";
import { inputClassName, fieldLabelClassName } from "@/components/forms/input-styles";

function parseDollar(raw: string): number | undefined {
  const cleaned = raw.replace(/[^0-9.-]/g, "");
  if (cleaned === "" || cleaned === "-") return undefined;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

function dollarString(n: number | undefined): string {
  return n === undefined ? "" : String(n);
}

export function PoliciesTableInspector({
  props,
  onChange,
}: WidgetInspectorProps<"policiesTable">) {
  function updateRow(
    index: number,
    patch: Partial<PoliciesTableProps["rows"][number]>,
  ) {
    const rows = props.rows.map((r, i) => (i === index ? { ...r, ...patch } : r));
    onChange({ ...props, rows });
  }

  function addRow() {
    onChange({
      ...props,
      rows: [
        ...props.rows,
        { type: "", owner: "", annualPremium: 0, deathBenefit: undefined },
      ],
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
        <InspectorTextarea
          label="Empty-state message (shown when no rows)"
          value={props.emptyStateMessage ?? ""}
          onChange={(v) =>
            onChange({ ...props, emptyStateMessage: v || undefined })
          }
          rows={3}
        />
      </InspectorSection>
      <InspectorSection eyebrow="B · Rows">
        {props.rows.length === 0 ? (
          <div className="text-[12px] text-ink-3 italic">
            No policies yet. Add one below — the empty-state message renders
            in the report when this list is empty.
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
                    Policy {i + 1}
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
                  <label className={fieldLabelClassName}>Type</label>
                  <input
                    className={inputClassName}
                    value={row.type}
                    placeholder="Term Life, Whole Life, Disability, …"
                    onChange={(e) => updateRow(i, { type: e.target.value })}
                  />
                </div>
                <div>
                  <label className={fieldLabelClassName}>Owner</label>
                  <input
                    className={inputClassName}
                    value={row.owner}
                    onChange={(e) => updateRow(i, { owner: e.target.value })}
                  />
                </div>
                <div>
                  <label className={fieldLabelClassName}>
                    Death benefit (optional)
                  </label>
                  <input
                    className={inputClassName}
                    value={dollarString(row.deathBenefit)}
                    inputMode="numeric"
                    placeholder="500000"
                    onChange={(e) =>
                      updateRow(i, { deathBenefit: parseDollar(e.target.value) })
                    }
                  />
                </div>
                <div>
                  <label className={fieldLabelClassName}>Annual premium</label>
                  <input
                    className={inputClassName}
                    value={dollarString(row.annualPremium)}
                    inputMode="numeric"
                    placeholder="1200"
                    onChange={(e) =>
                      updateRow(i, {
                        annualPremium: parseDollar(e.target.value) ?? 0,
                      })
                    }
                  />
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
          + Add policy
        </button>
      </InspectorSection>
      <InspectorNotes
        value={props.notes ?? ""}
        onChange={(v) => onChange({ ...props, notes: v || undefined })}
      />
    </>
  );
}
