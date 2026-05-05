// src/lib/reports/clone-template.ts
//
// Stub for compilation only — Task 31 replaces this with a clone that
// regenerates page/row/widget ids so cloned templates don't collide
// with existing reports. Until then, structuredClone is enough for the
// CRUD route to compile and an empty TEMPLATES array means this is
// never actually called in v1's blank-only flow.

import type { ReportTemplate } from "@/lib/reports/templates";
import type { Page } from "@/lib/reports/types";

export function cloneTemplateWithFreshIds(
  t: ReportTemplate,
): { pages: Page[] } {
  return { pages: structuredClone(t.pages) }; // ids regenerated in Task 31
}
