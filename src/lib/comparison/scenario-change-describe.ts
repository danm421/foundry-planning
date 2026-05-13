import type { ScenarioChange } from "@/engine/scenario/types";

export type ChangeUnit =
  | { kind: "single"; change: ScenarioChange & { enabled: boolean } }
  | { kind: "group"; groupName: string; changes: Array<ScenarioChange & { enabled: boolean }> };

function fmtVal(v: unknown): string {
  if (typeof v === "number") {
    if (Number.isInteger(v) && v > 1900 && v < 2200) return String(v); // year-shaped
    if (Math.abs(v) >= 1000) return `$${Math.round(v).toLocaleString()}`;
    return String(v);
  }
  if (v == null) return "—";
  return String(v);
}

function nameFor(c: { targetKind: string; targetId: string }, names: Record<string, string>): string {
  return names[`${c.targetKind}:${c.targetId}`] ?? `${c.targetKind} ${c.targetId.slice(0, 6)}`;
}

export function describeChangeUnit(unit: ChangeUnit, targetNames: Record<string, string>): string {
  if (unit.kind === "single") {
    const c = unit.change;
    const name = nameFor(c, targetNames);
    if (c.opType === "add") return `Added: ${name}.`;
    if (c.opType === "remove") return `Removed: ${name}.`;
    // edit
    const payload = (c.payload ?? {}) as Record<string, { from: unknown; to: unknown }>;
    const fields = Object.keys(payload);
    if (fields.length === 0) return `Edited: ${name}.`;
    if (fields.length === 1) {
      const f = fields[0];
      const { from, to } = payload[f];
      return `Changed ${f} on ${name}: ${fmtVal(from)} → ${fmtVal(to)}.`;
    }
    return `Changed ${fields.length} fields on ${name}: ${fields.join(", ")}.`;
  }
  // group
  const names = unit.changes.map((c) => nameFor(c, targetNames));
  return `${unit.changes.length} changes: ${names.join(", ")}.`;
}
