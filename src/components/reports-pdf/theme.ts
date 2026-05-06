// src/components/reports-pdf/theme.ts
//
// PDF-side theme tokens. Re-exports from `lib/reports/theme.ts` (the single
// source of truth for both screen and PDF surfaces). `@react-pdf/renderer`
// consumes inline color strings, not CSS variables — this module exists to
// flatten the theme into the shape PDF widgets already import (`PDF_THEME.x`).
//
// **Do not edit colors here. Edit `lib/reports/theme.ts` and update the
// matching `--color-report-*` block in `app/globals.css` so the screen
// surface stays in sync.**

import { REPORT_THEME } from "@/lib/reports/theme";

const C = REPORT_THEME.colors;

export const PDF_THEME = {
  paper:       C.paper,
  card2:       C.card,
  ink:         C.ink,
  ink2:        C.ink2,
  ink3:        C.ink3,
  inkDeep:     C.inkDeep,
  inkOnDark:   C.inkOnDark,
  hair:        C.hair,
  zebra:       C.zebra,
  accent:      C.accent,
  good:        C.good,
  crit:        C.crit,
  steel:       C.steel,
  plum:        C.plum,
  accentTint:  C.accentTint,
  goodTint:    C.goodTint,
  critTint:    C.critTint,
  chart:       REPORT_THEME.chartPalette,
  category:    REPORT_THEME.categoryColors,
  type:        REPORT_THEME.type,
  rules:       REPORT_THEME.rules,
  radii:       REPORT_THEME.radii,
} as const;
