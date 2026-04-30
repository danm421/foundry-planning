"use client";

import type { FieldStrategy, FieldMap } from "@/lib/imports/merge-strategies";

interface DiffPreviewProps<T extends object> {
  existing: T;
  incoming: Partial<T>;
  fieldMap: FieldMap<T>;
  /** Optional pretty labels for the field column (defaults to the key). */
  fieldLabels?: Partial<Record<keyof T, string>>;
}

interface Row {
  field: string;
  oldValue: unknown;
  newValue: unknown;
  strategy: FieldStrategy;
  willChange: boolean;
}

const STRATEGY_LABEL: Record<FieldStrategy, string> = {
  replace: "replace",
  "replace-if-non-null": "if-non-null",
  "keep-existing": "keep",
};

function formatValue(v: unknown): string {
  if (v === null) return "—";
  if (v === undefined) return "—";
  if (v === "") return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "—";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

function isMeaningful(v: unknown): boolean {
  return v !== undefined && v !== null && v !== "";
}

/**
 * Compute whether the field value would change at commit time given
 * the strategy. Mirrors applyMerge() semantics in merge-strategies.ts.
 */
function willChange(
  oldVal: unknown,
  newVal: unknown,
  strategy: FieldStrategy,
): boolean {
  switch (strategy) {
    case "replace":
      return newVal !== undefined && oldVal !== newVal;
    case "replace-if-non-null":
      return isMeaningful(newVal) && oldVal !== newVal;
    case "keep-existing":
      return false;
  }
}

export default function DiffPreview<T extends object>({
  existing,
  incoming,
  fieldMap,
  fieldLabels,
}: DiffPreviewProps<T>) {
  const rows: Row[] = (
    Object.entries(fieldMap) as Array<[keyof T, FieldStrategy]>
  )
    .filter(([, strategy]) => strategy !== "keep-existing")
    .map(([key, strategy]) => {
      const oldValue = existing[key];
      const newValue = incoming[key];
      return {
        field: (fieldLabels?.[key] as string) ?? String(key),
        oldValue,
        newValue,
        strategy,
        willChange: willChange(oldValue, newValue, strategy),
      };
    })
    .filter((r) => r.willChange);

  if (rows.length === 0) {
    return (
      <p className="text-xs text-ink-4">
        No field changes — the existing row already matches.
      </p>
    );
  }

  return (
    <table className="w-full text-xs">
      <thead className="text-left uppercase tracking-wide text-ink-4">
        <tr>
          <th className="py-1 font-medium">Field</th>
          <th className="py-1 font-medium">Existing</th>
          <th className="py-1 font-medium">Incoming</th>
          <th className="py-1 font-medium">Strategy</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.field} className="border-t border-hair">
            <td className="py-1 text-ink-2">{r.field}</td>
            <td className="py-1 text-ink-3 line-through">
              {formatValue(r.oldValue)}
            </td>
            <td className="py-1 text-ink">{formatValue(r.newValue)}</td>
            <td className="py-1 font-mono text-ink-4">
              {STRATEGY_LABEL[r.strategy]}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
