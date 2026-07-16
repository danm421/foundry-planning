import type { ReportKey } from "@/lib/solver/report-layout";

/** Re-exported so existing `./report-tab-link` imports keep working. The
 *  canonical definition lives in `@/lib/solver/report-layout`. */
export type { ReportKey };

/** The five left-pane input tabs. */
export type InputTab = "retirement" | "techniques" | "stress_test" | "life_insurance" | "education";
