"use client";

import type { IntakeDraft } from "@/lib/intake/schema";
import { CardList, inputCls, labelCls, selectCls } from "./card-list";

// ─── Types ───────────────────────────────────────────────────────────────────

export type PropertySlice = IntakeDraft["property"];
type PropertyItem = NonNullable<PropertySlice>[number];

export interface PropertyStepProps {
  value: PropertySlice;
  onChange: (next: PropertySlice) => void;
}

// ─── Options ─────────────────────────────────────────────────────────────────

const KIND_OPTIONS = [
  { value: "real_estate", label: "Real estate" },
  { value: "business",    label: "Business interest" },
] as const;

// ─── Blank template ──────────────────────────────────────────────────────────

function blankProperty(): PropertyItem {
  return { name: "", kind: "real_estate", value: 0 };
}

// ─── PropertyStep ─────────────────────────────────────────────────────────────

export function PropertyStep({ value, onChange }: PropertyStepProps) {
  const property = value ?? [];

  function addProperty() {
    onChange([...property, blankProperty()]);
  }

  function removeProperty(index: number) {
    onChange(property.filter((_, i) => i !== index));
  }

  function updateProperty(index: number, patch: Partial<PropertyItem>) {
    onChange(property.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  return (
    <CardList
      heading="Property"
      addLabel="Add property"
      emptyMessage="No property added yet."
      items={property}
      onAdd={addProperty}
      onRemove={removeProperty}
      renderItem={(item, i) => {
        const idp = `property-${i}`;
        return (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Name */}
            <div className="sm:col-span-2">
              <label htmlFor={`${idp}-name`} className={labelCls}>
                Description
              </label>
              <input
                id={`${idp}-name`}
                type="text"
                className={inputCls}
                value={item.name ?? ""}
                onChange={(e) => updateProperty(i, { name: e.target.value })}
                placeholder="e.g. Main residence"
                aria-label="Description"
              />
            </div>

            {/* Kind */}
            <div>
              <label htmlFor={`${idp}-kind`} className={labelCls}>
                Kind
              </label>
              <select
                id={`${idp}-kind`}
                className={selectCls}
                value={item.kind ?? "real_estate"}
                onChange={(e) =>
                  updateProperty(i, { kind: e.target.value as PropertyItem["kind"] })
                }
                aria-label="Kind"
              >
                {KIND_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Value */}
            <div>
              <label htmlFor={`${idp}-value`} className={labelCls}>
                Estimated value ($)
              </label>
              <input
                id={`${idp}-value`}
                type="number"
                min={0}
                className={`${inputCls} tabular`}
                value={item.value ?? 0}
                onChange={(e) =>
                  updateProperty(i, {
                    value: e.target.value === "" ? undefined : Number(e.target.value),
                  })
                }
                aria-label="Estimated value"
              />
            </div>
          </div>
        );
      }}
    />
  );
}
