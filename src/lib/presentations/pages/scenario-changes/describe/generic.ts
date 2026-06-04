import type { ScenarioChange } from "@/engine/scenario/types";
import type { ChangeRow } from "../types";
import type { KindSpec } from "./specs";
import { nameFor, fieldLabel, fmtValue } from "./format";

export interface DescribeContext {
  targetNames: Record<string, string>;
}

type EditPayload = Record<string, { from: unknown; to: unknown }>;

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Add-row skeleton: "+ Name" / Added, with caller-supplied detail segments. */
export function addRow(area: ChangeRow["area"], name: string, detail: string[]): ChangeRow {
  return { area, what: `+ ${name}`, op: "add", before: "—", after: "Added", detail };
}

/** Remove-row skeleton: name / Removed (name + kind only — no base-plan load). */
export function removeRow(area: ChangeRow["area"], name: string, detail: string[]): ChangeRow {
  return { area, what: name, op: "remove", before: "In plan", after: "Removed", detail };
}

export function editRow(
  c: ScenarioChange,
  spec: KindSpec,
  name: string,
): ChangeRow {
  const payload = (c.payload ?? {}) as EditPayload;
  const fields = Object.keys(payload);

  if (fields.length === 1) {
    const f = fields[0];
    const { from, to } = payload[f] ?? { from: null, to: null };
    const what = spec.whatMode === "field" ? fieldLabel(f) : `${name} · ${fieldLabel(f)}`;
    return { area: spec.area, what, op: "edit", before: fmtValue(from), after: fmtValue(to), detail: [spec.whyEdit] };
  }

  const what = spec.whatMode === "field" ? capitalize(spec.noun) : name;
  // One detail segment per changed field: "Label: before → after".
  const detail =
    fields.length === 0
      ? [spec.whyEdit]
      : fields.map((f) => `${fieldLabel(f)}: ${fmtValue(payload[f]?.from)} → ${fmtValue(payload[f]?.to)}`);
  return { area: spec.area, what, op: "edit", before: "—", after: "Updated", detail };
}

export function describeFromSpec(
  c: ScenarioChange,
  ctx: DescribeContext,
  spec: KindSpec,
): ChangeRow {
  const name = nameFor(c, ctx.targetNames) ?? capitalize(spec.noun);

  if (c.opType === "add") {
    return addRow(spec.area, name, [spec.whyAdd]);
  }
  if (c.opType === "remove") {
    return removeRow(spec.area, name, [spec.whyRemove]);
  }
  return editRow(c, spec, name);
}
