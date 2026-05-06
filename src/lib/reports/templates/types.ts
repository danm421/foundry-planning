// src/lib/reports/templates/types.ts
//
// Pure type-only export — extracted from `index.ts` so per-template files
// (annual-review, retirement-roadmap, …) can import the type without pulling
// in the full TEMPLATES array (avoids circular imports).

import type { Page } from "@/lib/reports/types";

export type ReportTemplate = {
  key: string;
  label: string;
  description: string;
  pages: Page[];
};
