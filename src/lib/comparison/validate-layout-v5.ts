import type { ComparisonLayoutV5 } from "./layout-schema";
import { COMPARISON_WIDGETS } from "./widgets/registry";

export type ValidationResult =
  | { ok: true }
  | { ok: false; errors: string[] };

export function validateLayoutV5(layout: ComparisonLayoutV5): ValidationResult {
  const errors: string[] = [];

  for (const group of layout.groups) {
    for (const cell of group.cells) {
      if (cell.widget === null) continue;
      const def = COMPARISON_WIDGETS[cell.widget.kind];
      if (!def) {
        errors.push(`unknown widget kind: ${cell.widget.kind}`);
        continue;
      }
      const count = cell.widget.planIds.length;
      const expectation = def.scenarios;

      if (expectation === "none" && count !== 0) {
        errors.push(`${cell.widget.kind} expects 0 plans, got ${count}`);
      } else if (expectation === "one" && count !== 1) {
        errors.push(`${cell.widget.kind} expects exactly 1 plan, got ${count}`);
      } else if (expectation === "one-or-many" && count < 1) {
        errors.push(`${cell.widget.kind} expects 1 or more plans, got 0`);
      } else if (expectation === "many-only" && count < 2) {
        errors.push(`${cell.widget.kind} expects 2 or more plans, got ${count}`);
      }
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
