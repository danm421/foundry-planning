import { REPORT_KEYS, canonicalReportId, type ReportKey } from "@/lib/solver/report-layout";

/** Re-exported so existing `./report-tab-link` imports keep working. The
 *  canonical definition lives in `@/lib/solver/report-layout`. */
export type { ReportKey };

/** The six left-pane input tabs. */
export type InputTab = "retirement" | "techniques" | "stress_test" | "life_insurance" | "education" | "changes";

const INPUT_TABS: readonly InputTab[] = [
  "retirement",
  "techniques",
  "stress_test",
  "life_insurance",
  "education",
  "changes",
];

const DEFAULT_INPUT_TAB: InputTab = "retirement";
const DEFAULT_REPORT: ReportKey = "portfolio";

/** The left tab for a raw `?tab=` value. Anything unrecognised, including a
 *  hand-edited URL, falls back to Retirement. */
export function resolveInputTab(raw: string | undefined): InputTab {
  return (INPUT_TABS as readonly string[]).includes(raw ?? "") ? (raw as InputTab) : DEFAULT_INPUT_TAB;
}

/** The right report for a raw `?report=` value, falling back to Portfolio. The
 *  workspace still reconciles it against the advisor's layout, so a hidden
 *  report is never selected. */
export function resolveReportParam(raw: string | undefined): ReportKey {
  const id = raw == null ? "" : canonicalReportId(raw);
  return (REPORT_KEYS as readonly string[]).includes(id) ? (id as ReportKey) : DEFAULT_REPORT;
}

/** The query string recording the open views, preserving every other param
 *  (notably `?scenario=`). Defaults are left out so a plain visit keeps a clean
 *  URL. Shaped like `location.search`: leading "?", or "" when empty. */
export function solverViewQuery(current: URLSearchParams, tab: InputTab, report: ReportKey): string {
  const next = new URLSearchParams(current);
  if (tab === DEFAULT_INPUT_TAB) next.delete("tab");
  else next.set("tab", tab);
  if (report === DEFAULT_REPORT) next.delete("report");
  else next.set("report", report);
  const qs = next.toString();
  return qs ? `?${qs}` : "";
}
