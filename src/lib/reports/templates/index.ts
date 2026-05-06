// src/lib/reports/templates/index.ts
//
// The CRUD route does `TEMPLATES.find(t => t.key === templateKey)` and then
// passes the result through `cloneTemplateWithFreshIds` to build a fresh
// page tree. Per-template files live next door so they can be authored in
// isolation; the type itself is in `./types` to avoid a circular import.

import type { ReportTemplate } from "./types";
import { annualReviewTemplate } from "./annual-review";
import { retirementRoadmapTemplate } from "./retirement-roadmap";

export const TEMPLATES: ReportTemplate[] = [
  annualReviewTemplate,
  retirementRoadmapTemplate,
];

export type { ReportTemplate };
