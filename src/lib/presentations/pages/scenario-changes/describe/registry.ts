import type { ScenarioChange, TargetKind } from "@/engine/scenario/types";
import type { ChangeRow, ChangeArea } from "../types";
import { addRow, removeRow, editRow, describeFromSpec, type DescribeContext } from "./generic";
import { nameFor } from "./format";
import { SPEC, type KindSpec } from "./specs";
import { joinSegments } from "./labels";

export type Describer = (c: ScenarioChange, ctx: DescribeContext) => ChangeRow;

/** Field extractor for the simpleDescriber add-summary. Returns one segment or null. */
export type Seg = (payload: Record<string, unknown>, ctx: DescribeContext) => string | null;

export interface SimpleSpec {
  area: ChangeArea;
  noun: string;
  /** segments composed (·-joined) into a single add-detail line */
  segments: Seg[];
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Factory for uniform kinds: name + a ·-joined summary of a few formatted fields. */
export function simpleDescriber(spec: SimpleSpec & Pick<KindSpec, "whatMode">): Describer {
  return (c, ctx) => {
    const name = nameFor(c, ctx.targetNames) ?? cap(spec.noun);
    if (c.opType === "remove") return removeRow(spec.area, name, [`No longer in this plan`]);
    if (c.opType === "add") {
      const p = (c.payload ?? {}) as Record<string, unknown>;
      const summary = joinSegments(spec.segments.map((seg) => seg(p, ctx)));
      return addRow(spec.area, name, summary ? [summary] : []);
    }
    // edit → reuse the generic field-diff skeleton (KindSpec shape from SPEC table)
    return editRow(c, { ...SPEC[c.targetKind], area: spec.area, noun: spec.noun }, name);
  };
}

// Bespoke + simple describers are registered in later tasks. Until a kind is added,
// it routes through the spec-based fallback to preserve Phase-1 behaviour.
const FALLBACK_SPEC: KindSpec = {
  area: "Plan & Assumptions", noun: "plan change", whatMode: "name",
  whyAdd: "A change was added to the plan.", whyRemove: "A change was removed from the plan.",
  whyEdit: "A change was made to the plan.",
};
const specFallback: Describer = (c, ctx) => describeFromSpec(c, ctx, SPEC[c.targetKind] ?? FALLBACK_SPEC);

export const DESCRIBERS: Partial<Record<TargetKind, Describer>> = {
  // populated by kinds/*.ts registrations in later tasks
};

export function resolveDescriber(kind: TargetKind): Describer {
  return DESCRIBERS[kind] ?? specFallback;
}
