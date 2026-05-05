// src/lib/reports/templates/index.ts
//
// Stub for compilation only — real templates land in Task 31. The CRUD
// route uses TEMPLATES.find() to look up a template by key, so an empty
// array is fine: any non-"blank" template request will 400 until 31 ships.

import type { Page } from "@/lib/reports/types";

export type ReportTemplate = {
  key: string;
  label: string;
  description: string;
  pages: Page[];
};

export const TEMPLATES: ReportTemplate[] = [];
