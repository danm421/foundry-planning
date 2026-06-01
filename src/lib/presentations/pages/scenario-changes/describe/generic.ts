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
    return { area: spec.area, what, op: "edit", before: fmtValue(from), after: fmtValue(to), why: spec.whyEdit };
  }

  const what = spec.whatMode === "field" ? capitalize(spec.noun) : name;
  const why =
    fields.length === 0
      ? spec.whyEdit
      : `Updates ${fields.map((f) => fieldLabel(f).toLowerCase()).join(", ")}.`;
  return { area: spec.area, what, op: "edit", before: "—", after: "Updated", why };
}

export function describeFromSpec(
  c: ScenarioChange,
  ctx: DescribeContext,
  spec: KindSpec,
): ChangeRow {
  const name = nameFor(c, ctx.targetNames) ?? capitalize(spec.noun);

  if (c.opType === "add") {
    return { area: spec.area, what: `+ ${name}`, op: "add", before: "—", after: "Added", why: spec.whyAdd };
  }
  if (c.opType === "remove") {
    return { area: spec.area, what: name, op: "remove", before: "In plan", after: "Removed", why: spec.whyRemove };
  }
  return editRow(c, spec, name);
}
