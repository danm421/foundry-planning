import type { FindingLineRef } from "../types";

/**
 * The citation footer under a finding card, e.g.
 * "Schedule E line 3 · line 18 · line 20 · Schedule 1 line 5".
 *
 * The form name prints once per RUN of consecutive refs sharing it, so a
 * four-line Schedule E citation doesn't repeat "Schedule E" four times. Shared
 * by the report view and the PDF — the same contract `activityDetailRows` has,
 * so the two surfaces can't drift.
 */
export function formatLineRefs(refs: FindingLineRef[]): string {
  const parts: string[] = [];
  let lastForm: string | null = null;
  for (const r of refs) {
    parts.push(r.form === lastForm ? r.line : `${r.form} ${r.line}`);
    lastForm = r.form;
  }
  return parts.join(" · ");
}
