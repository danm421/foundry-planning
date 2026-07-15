/**
 * Pure, framework-free model for the solver right-panel report tab strip: which
 * reports exist (canonical), and a per-advisor layout = their order + visibility.
 *
 * This module is the single source of truth for `ReportKey` and `REPORT_KEYS`.
 * It must stay free of React / @/db / Next imports — it's imported by client
 * components and (type-only) by the Drizzle schema.
 */

/** The right-pane report views (charts, the summaries deck, and the balance sheet). */
export type ReportKey =
  | "portfolio"
  | "cashflow"
  | "taxBracket"
  | "lifeInsurance"
  | "estate"
  | "monteCarlo"
  | "education"
  | "balanceSheet"
  | "summaries";

/** Canonical report order. `REPORT_TABS` in solver-chart-panel.tsx must match. */
export const REPORT_KEYS: readonly ReportKey[] = [
  "portfolio",
  "cashflow",
  "taxBracket",
  "lifeInsurance",
  "estate",
  "monteCarlo",
  "education",
  "balanceSheet",
  "summaries",
];

/** One report's place in an advisor's customized strip. */
export interface ReportLayoutEntry {
  id: ReportKey;
  visible: boolean;
}

/**
 * Reconcile a stored (possibly stale / partial / malformed) layout against the
 * canonical report set. Rules:
 *   1. null/empty → canonical order, all visible.
 *   2. keep stored entries whose id is canonical, in stored order (de-duped;
 *      first occurrence wins).
 *   3. append canonical ids missing from stored at the end, visible: true
 *      (a newly-shipped report shows up automatically for existing advisors).
 *   4. drop stored ids not in canonical (a removed report).
 *   5. guarantee at least one visible (defensive; the UI also prevents this).
 */
export function resolveReportLayout(
  stored: { id: string; visible: boolean }[] | null | undefined,
  canonical: readonly ReportKey[] = REPORT_KEYS,
): ReportLayoutEntry[] {
  const canonicalSet = new Set<string>(canonical);
  const seen = new Set<ReportKey>();
  const out: ReportLayoutEntry[] = [];

  if (stored) {
    for (const e of stored) {
      if (!canonicalSet.has(e.id)) continue;
      const id = e.id as ReportKey;
      if (seen.has(id)) continue;
      out.push({ id, visible: Boolean(e.visible) });
      seen.add(id);
    }
  }

  for (const k of canonical) {
    if (!seen.has(k)) out.push({ id: k, visible: true });
  }

  if (out.length > 0 && !out.some((e) => e.visible)) {
    out[0] = { ...out[0], visible: true };
  }
  return out;
}

/** Visible reports, in display order. */
export function visibleReportsInOrder(layout: ReportLayoutEntry[]): ReportKey[] {
  return layout.filter((e) => e.visible).map((e) => e.id);
}

/** First visible report (falls back to the canonical first if none). */
export function firstVisibleReport(layout: ReportLayoutEntry[]): ReportKey {
  return layout.find((e) => e.visible)?.id ?? REPORT_KEYS[0];
}

/** Whether a report is present AND visible in the layout. */
export function isReportVisible(
  key: ReportKey,
  layout: ReportLayoutEntry[],
): boolean {
  return layout.some((e) => e.id === key && e.visible);
}

/**
 * Pick the active report given a preferred target (e.g. an input tab's default):
 * keep it if visible, else fall back to the first visible report. Keeps the
 * invariant "the active report is always a visible tab."
 */
export function resolveActiveReport(
  preferred: ReportKey,
  layout: ReportLayoutEntry[],
): ReportKey {
  return isReportVisible(preferred, layout) ? preferred : firstVisibleReport(layout);
}
