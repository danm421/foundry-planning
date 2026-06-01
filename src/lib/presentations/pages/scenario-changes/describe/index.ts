import type { ScenarioChange } from "@/engine/scenario/types";
import type { ChangeRow } from "../types";
import { SPEC, type KindSpec } from "./specs";
import { describeFromSpec, type DescribeContext } from "./generic";

export type { DescribeContext } from "./generic";

const FALLBACK_SPEC: KindSpec = {
  area: "Plan & Assumptions",
  noun: "plan change",
  whatMode: "name",
  whyAdd: "A change was added to the plan.",
  whyRemove: "A change was removed from the plan.",
  whyEdit: "A change was made to the plan.",
};

export function describeChange(c: ScenarioChange, ctx: DescribeContext): ChangeRow {
  const spec = SPEC[c.targetKind] ?? FALLBACK_SPEC;
  return describeFromSpec(c, ctx, spec);
}
