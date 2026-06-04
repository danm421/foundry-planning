import type { ScenarioChange } from "@/engine/scenario/types";
import type { ChangeRow } from "../types";
import { resolveDescriber } from "./registry";
import type { DescribeContext } from "./generic";

export type { DescribeContext } from "./generic";

export function describeChange(c: ScenarioChange, ctx: DescribeContext): ChangeRow {
  return resolveDescriber(c.targetKind)(c, ctx);
}

// Per-kind describer registrations (side-effect imports). Kept at the END to
// avoid a circular import: kinds/*.ts import DESCRIBERS from ./registry, and
// resolveDescriber/describeChange must be defined before they run.
import "./kinds/savings";
import "./kinds/plan";
import "./kinds/assets";
import "./kinds/taxes";
