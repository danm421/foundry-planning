// src/components/reports/widget-inspectors/action-items-list.tsx
//
// Inspector body for the actionItemsList widget. Title (A) + an editable
// items list (B) where each item has a priority dropdown
// (high/medium/low), a multi-line text input for the action, and an
// optional timeframe text input. An "+ Add item" button appends a fresh
// medium-priority blank item.

import type { WidgetInspectorProps } from "@/lib/reports/widget-registry";
import type { ActionItemsListProps } from "@/lib/reports/types";
import { InspectorSection } from "../inspector/section";
import { InspectorTextInput } from "../inspector/text-input";
import { InspectorSelect } from "../inspector/select";
import { InspectorNotes } from "../inspector/notes";
import { fieldLabelClassName } from "@/components/forms/input-styles";

type Item = ActionItemsListProps["items"][number];

const PRIORITY_OPTIONS: readonly { value: Item["priority"]; label: string }[] = [
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

function blankItem(): Item {
  return { priority: "medium", text: "" };
}

export function ActionItemsListInspector({
  props,
  onChange,
}: WidgetInspectorProps<"actionItemsList">) {
  const updateItem = (index: number, patch: Partial<Item>) => {
    const next = props.items.map((it, i) =>
      i === index ? { ...it, ...patch } : it,
    );
    onChange({ ...props, items: next });
  };
  const removeItem = (index: number) => {
    onChange({ ...props, items: props.items.filter((_, i) => i !== index) });
  };
  const addItem = () => {
    onChange({ ...props, items: [...props.items, blankItem()] });
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
      <InspectorSection eyebrow="B · Items">
        <div className="space-y-3">
          {props.items.map((it, i) => (
            <div
              key={i}
              className="rounded-sm border border-hair p-3 space-y-2 bg-card-2"
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono uppercase tracking-wider text-ink-3">
                  Item {i + 1}
                </span>
                <button
                  type="button"
                  onClick={() => removeItem(i)}
                  className="text-[11px] font-mono text-crit hover:opacity-80"
                >
                  remove
                </button>
              </div>
              <InspectorSelect
                label="Priority"
                value={it.priority}
                onChange={(v) => updateItem(i, { priority: v })}
                options={PRIORITY_OPTIONS}
              />
              <div>
                <label className={fieldLabelClassName}>Text</label>
                <textarea
                  rows={2}
                  value={it.text}
                  onChange={(e) => updateItem(i, { text: e.target.value })}
                  className="w-full rounded-[var(--radius-sm)] bg-card-2 border border-hair px-3 py-2 text-[14px] focus:border-accent focus:ring-2 focus:ring-accent/25"
                />
              </div>
              <InspectorTextInput
                label="Timeframe (optional)"
                value={it.timeframe ?? ""}
                onChange={(v) =>
                  updateItem(i, { timeframe: v || undefined })
                }
              />
            </div>
          ))}
          <button
            type="button"
            onClick={addItem}
            className="w-full h-8 text-[12px] font-mono text-ink-3 border border-dashed border-hair rounded-sm hover:text-ink hover:border-ink-3 transition"
          >
            + Add item
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
