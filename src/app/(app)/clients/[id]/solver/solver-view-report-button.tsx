"use client";

import { ChevronRightIcon } from "@/components/icons";

/** Small "View report" affordance that sits next to a left-pane input header and
 *  switches the right pane to that surface's report. Rendered only when the
 *  report is visible in the advisor's layout (see LiveSolverWorkspace) so it can
 *  never select a report the tab strip is hiding. */
export function SolverViewReportButton({
  reportLabel,
  onClick,
}: {
  /** Full report name for the accessible label — keep it identical to that
   *  report's `label` in `REPORT_TABS` (solver-chart-panel.tsx), which names the
   *  tab this button selects. */
  reportLabel: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`View the ${reportLabel} report`}
      aria-label={`View the ${reportLabel} report`}
      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-hair-2 px-2 py-1 text-[11px] font-medium normal-case tracking-normal text-accent transition-colors hover:border-accent/60"
    >
      View report
      <ChevronRightIcon aria-hidden="true" className="h-3 w-3" />
    </button>
  );
}
