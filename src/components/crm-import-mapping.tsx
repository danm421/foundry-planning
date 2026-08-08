"use client";

import {
  FIELD_LABELS,
  IMPORT_FIELDS,
  REQUIRED_FIELDS,
  missingRequiredFields,
  type ColumnMapping,
  type ImportField,
} from "@/lib/crm/import/columns";

interface CrmImportMappingProps {
  header: string[];
  mapping: ColumnMapping;
  onChange: (next: ColumnMapping) => void;
}

/**
 * Field → file-column picker. Auto-detection fills this in on upload; the
 * advisor only touches it when a column was named something we didn't
 * recognise. A field set to "Not imported" is simply absent from the mapping.
 */
export function CrmImportMapping({ header, mapping, onChange }: CrmImportMappingProps) {
  const missingRequired = missingRequiredFields(mapping);

  function setField(field: ImportField, raw: string) {
    const next: ColumnMapping = { ...mapping };
    if (raw === "") {
      delete next[field];
    } else {
      next[field] = Number(raw);
    }
    onChange(next);
  }

  return (
    <section>
      <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wider text-ink-3">
        Column mapping
      </h2>
      {missingRequired.length > 0 && (
        <div
          role="alert"
          className="mb-3 rounded-[var(--radius-sm)] border border-crit/30 bg-crit/10 px-3 py-2 text-[13px] text-crit"
        >
          Pick a column for {missingRequired.map((f) => FIELD_LABELS[f]).join(" and ")} —
          nothing can import without a name.
        </div>
      )}
      <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        {IMPORT_FIELDS.map((field) => {
          const id = `map-${field}`;
          const required = REQUIRED_FIELDS.includes(field);
          return (
            <div key={field} className="flex items-center justify-between gap-3">
              <label htmlFor={id} className="text-[13px] text-ink-2">
                {FIELD_LABELS[field]}
                {required && <span className="ml-1 text-crit">*</span>}
              </label>
              <select
                id={id}
                value={mapping[field] ?? ""}
                onChange={(e) => setField(field, e.target.value)}
                className="h-8 min-w-[10rem] rounded-[var(--radius-sm)] border border-hair bg-card-2 px-2 text-[12px] text-ink"
              >
                <option value="">Not imported</option>
                {header.map((h, i) => (
                  <option key={i} value={i}>
                    {h || `Column ${i + 1}`}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
    </section>
  );
}
