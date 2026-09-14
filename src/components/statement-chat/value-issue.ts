// src/components/statement-chat/value-issue.ts
import type { ValueIssue } from "@/lib/entity-extraction/types";

/**
 * Why one extracted value cannot be trusted, in the advisor's words.
 *
 * ONE vocabulary, deliberately shared by the two places a flagged value
 * surfaces (final review C2/I6, Ruling 35): the marker beside the value in its
 * own cell (`map-columns.ts`) and the reason on the row's disabled Commit
 * button (`entity-tables.tsx`). Two wordings for the same flag would read as
 * two different problems to the person looking at one row.
 *
 * Phrased as a short noun clause so it reads correctly in both frames:
 * "Death benefit (unreadable)" in a cell, and "Check Death benefit
 * (unreadable)" under the button.
 */
const ISSUE_REASONS: Record<ValueIssue, string> = {
  coercion: "unreadable",
  enum: "not a known option",
  range: "out of range",
  ungrounded: "not found in the document",
};

export function issueReason(issue: ValueIssue): string {
  return ISSUE_REASONS[issue];
}
