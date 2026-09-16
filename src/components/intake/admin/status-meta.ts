import type { IntakeFormRow } from "@/lib/intake/queries";

/**
 * Per-status presentation: a plain-language label and the pip colour. Status is
 * carried by the word as well as the pip, so it never rests on colour alone.
 *
 * Shared by the queue and the in-flight detail view — an advisor who clicks a
 * row labelled "Awaiting reply" must not land on a page that calls the same
 * form something else.
 *
 * Keyed by the status enum rather than `string`, so adding a sixth intake
 * status fails the build here instead of rendering an unlabelled row.
 */
export const STATUS_META: Record<
  IntakeFormRow["status"],
  { label: string; pip: string; text: string }
> = {
  draft: { label: "Awaiting reply", pip: "bg-ink-4", text: "text-ink-3" },
  submitted: { label: "Ready to review", pip: "bg-accent", text: "text-accent" },
  applied: { label: "Applied", pip: "bg-good", text: "text-good" },
  discarded: { label: "Discarded", pip: "bg-ink-4", text: "text-ink-4" },
  expired: { label: "Expired", pip: "bg-warn", text: "text-warn" },
};
