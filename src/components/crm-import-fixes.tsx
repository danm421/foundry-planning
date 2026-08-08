"use client";

import { useState } from "react";
import { FIELD_LABELS, type ImportField } from "@/lib/crm/import/columns";
import type { ParsedRow, RowOverride } from "@/lib/crm/import/rows";

interface CrmImportFixesProps {
  rows: ParsedRow[];
  overrides: RowOverride[];
  /** Fires on blur with the complete replacement override list. */
  onCommitEdit: (next: RowOverride[]) => void;
}

/**
 * The rows that need attention, and only those. Errors block a row from
 * importing; warnings don't — both are fixable here, and the fix re-runs the
 * whole derivation server-side so a corrected surname also corrects the
 * generated household name.
 */
export function CrmImportFixes({ rows, overrides, onCommitEdit }: CrmImportFixesProps) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const flagged = rows.filter((r) => r.errors.length > 0 || r.warnings.length > 0);
  if (flagged.length === 0) return null;

  function key(rowIndex: number, field: ImportField) {
    return `${rowIndex}:${field}`;
  }

  function valueFor(rowIndex: number, field: ImportField): string {
    const k = key(rowIndex, field);
    if (k in drafts) return drafts[k];
    const existing = overrides.find((o) => o.rowIndex === rowIndex && o.field === field);
    return existing?.value ?? "";
  }

  function commit(rowIndex: number, field: ImportField) {
    const k = key(rowIndex, field);
    // Never typed into — a bare Tab-through blur must not fire a remap POST.
    if (!(k in drafts)) return;
    const value = drafts[k] ?? "";
    const existing = overrides.find((o) => o.rowIndex === rowIndex && o.field === field);
    // Typed value matches what's already committed — nothing changed.
    if (value === (existing?.value ?? "")) return;
    const next = overrides.filter((o) => !(o.rowIndex === rowIndex && o.field === field));
    if (value.trim() !== "") next.push({ rowIndex, field, value });
    onCommitEdit(next);
  }

  return (
    <section>
      <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wider text-ink-3">
        Fix these {flagged.length} row{flagged.length === 1 ? "" : "s"}
      </h2>
      <div className="space-y-3">
        {flagged.map((row) => {
          const blocked = row.errors.length > 0;
          const issues = [...row.errors, ...row.warnings];
          const fields = Array.from(
            new Set(issues.map((i) => i.field).filter((f): f is ImportField => f !== "row")),
          );
          return (
            <div
              key={row.rowIndex}
              className={`rounded-[var(--radius-sm)] border p-3 ${
                blocked ? "border-crit/30 bg-crit/5" : "border-hair bg-card-2"
              }`}
            >
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <span className="text-[13px] font-medium text-ink">
                  Row {row.rowIndex + 1}
                  {row.household.name ? ` — ${row.household.name}` : ""}
                </span>
                <span className={`text-[12px] ${blocked ? "text-crit" : "text-ink-3"}`}>
                  {blocked ? "Won't import" : "Will import"}
                </span>
              </div>
              <ul className="mb-2 list-disc pl-4 text-[12px] text-ink-3">
                {issues.map((i, n) => (
                  <li key={n} className={row.errors.includes(i) ? "text-crit" : undefined}>
                    {i.message}
                  </li>
                ))}
              </ul>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {fields.map((field) => {
                  const id = `fix-${row.rowIndex}-${field}`;
                  return (
                    <div key={field}>
                      <label htmlFor={id} className="mb-1 block text-[12px] text-ink-2">
                        {FIELD_LABELS[field]}
                      </label>
                      <input
                        id={id}
                        type="text"
                        value={valueFor(row.rowIndex, field)}
                        onChange={(e) =>
                          setDrafts((d) => ({ ...d, [key(row.rowIndex, field)]: e.target.value }))
                        }
                        onBlur={() => commit(row.rowIndex, field)}
                        className="h-8 w-full rounded-[var(--radius-sm)] border border-hair bg-card px-2 text-[13px] text-ink"
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
