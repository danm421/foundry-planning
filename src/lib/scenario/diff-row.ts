export type RowDiff =
  | { kind: "unchanged" }
  | { kind: "add" }
  | { kind: "remove" }
  | { kind: "edit"; fields: Array<{ field: string; from: unknown; to: unknown }> };

const META_FIELDS = new Set(["id", "createdAt", "updatedAt", "scenarioId"]);

export function computeRowDiff(
  base: Record<string, unknown> | null,
  effective: Record<string, unknown> | null,
): RowDiff {
  if (!base && effective) return { kind: "add" };
  if (base && !effective) return { kind: "remove" };
  if (!base || !effective) return { kind: "unchanged" };

  const fields: Array<{ field: string; from: unknown; to: unknown }> = [];
  const keys = new Set([...Object.keys(base), ...Object.keys(effective)]);
  for (const k of keys) {
    if (META_FIELDS.has(k)) continue;
    if (JSON.stringify(base[k]) !== JSON.stringify(effective[k])) {
      fields.push({ field: k, from: base[k], to: effective[k] });
    }
  }
  return fields.length === 0 ? { kind: "unchanged" } : { kind: "edit", fields };
}
