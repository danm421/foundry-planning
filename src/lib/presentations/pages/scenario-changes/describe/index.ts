import type { ScenarioChange } from "@/engine/scenario/types";
import type { ChangeRow } from "../types";
import { resolveDescriber } from "./registry";
import type { DescribeContext } from "./generic";

export type { DescribeContext } from "./generic";

export function describeChange(c: ScenarioChange, ctx: DescribeContext): ChangeRow {
  return resolveDescriber(c.targetKind)(c, ctx);
}
