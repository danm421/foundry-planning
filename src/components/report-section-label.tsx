"use client";

import { useReportSectionLabel } from "./back-nav-provider";

/**
 * Registers `label` as the friendly name for the current section so the back
 * button can show it even after this page unmounts. Renders nothing.
 */
export default function ReportSectionLabel({ label }: { label: string }): null {
  useReportSectionLabel(label);
  return null;
}
