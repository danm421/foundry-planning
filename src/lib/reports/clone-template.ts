// src/lib/reports/clone-template.ts
//
// Materialise a `ReportTemplate` into a fresh page tree by regenerating
// every page / row / widget id. The template object itself is left
// untouched (we never mutate slots or rows in place), so the same template
// can be cloned repeatedly without collision.

import type { ReportTemplate } from "./templates";
import type { Page } from "@/lib/reports/types";

export function cloneTemplateWithFreshIds(
  t: ReportTemplate,
): { pages: Page[] } {
  return {
    pages: t.pages.map((p) => ({
      ...p,
      id: crypto.randomUUID(),
      rows: p.rows.map((r) => ({
        ...r,
        id: crypto.randomUUID(),
        slots: r.slots.map((w) =>
          w ? { ...w, id: crypto.randomUUID() } : null,
        ),
      })),
    })),
  };
}
