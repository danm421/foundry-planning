// src/components/forge/meeting-review-card.tsx
//
// Presentational card that renders a `meeting_review` payload for advisor
// review before it is saved to CRM. The advisor can:
//   • Edit the summary title and body text
//   • Change the meeting date
//   • Toggle individual proposed tasks in/out via a checkbox
//   • Edit each task's title, priority, and due date inline
//
// On "Save to CRM" the card emits onApprove with only the included tasks
// (the `included` flag is stripped before emitting). On "Cancel" it calls
// onCancel() and the panel discards the review.

"use client";
import { useState } from "react";
import type { MeetingReviewPayload, ProposedTaskView } from "./use-forge-stream";

interface MeetingReviewCardProps {
  review: MeetingReviewPayload;
  busy: boolean;
  onApprove: (payload: {
    approved: true;
    summaryTitle: string;
    summary: string;
    meetingDate: string;
    tasks: ProposedTaskView[];
  }) => void;
  onCancel: () => void;
}

type Row = ProposedTaskView & { included: boolean };

export function MeetingReviewCard({ review, busy, onApprove, onCancel }: MeetingReviewCardProps) {
  const today = new Date().toISOString().slice(0, 10);
  const [summaryTitle, setSummaryTitle] = useState(review.summaryTitle);
  const [summary, setSummary] = useState(review.summary);
  const [meetingDate, setMeetingDate] = useState(review.meetingDate ?? today);
  const [rows, setRows] = useState<Row[]>(() =>
    review.proposedTasks.map((t) => ({ ...t, included: true })),
  );

  function patch(i: number, p: Partial<Row>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...p } : r)));
  }

  function submit() {
    onApprove({
      approved: true,
      summaryTitle,
      summary,
      // A cleared date input yields "" — fall back to today so the note write
      // never gets an empty/invalid date (createNote would reject it).
      meetingDate: meetingDate || today,
      tasks: rows
        .filter((r) => r.included)
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        .map(({ included: _included, ...t }) => t),
    });
  }

  return (
    <div className="rounded-[var(--radius)] border border-hair bg-card-2/40">
      {/* Header */}
      <div className="border-b border-hair px-4 py-2.5 text-[12px] font-medium text-ink-2">
        Review meeting summary &amp; tasks
      </div>

      {/* Body */}
      <div className="space-y-3 px-4 py-3">
        {/* Summary title */}
        <div className="space-y-1">
          <label htmlFor="meeting-summary-title" className="block text-[11px] font-medium text-ink-3">
            Summary title
          </label>
          <input
            id="meeting-summary-title"
            value={summaryTitle}
            disabled={busy}
            onChange={(e) => setSummaryTitle(e.target.value)}
            className="w-full rounded-[var(--radius-sm)] border border-hair bg-card px-2 py-1 text-[13px] text-ink disabled:opacity-50"
          />
        </div>

        {/* Summary body */}
        <div className="space-y-1">
          <label htmlFor="meeting-summary-body" className="block text-[11px] font-medium text-ink-3">
            Summary
          </label>
          <textarea
            id="meeting-summary-body"
            value={summary}
            disabled={busy}
            rows={6}
            onChange={(e) => setSummary(e.target.value)}
            className="w-full resize-y rounded-[var(--radius-sm)] border border-hair bg-card px-2 py-1 text-[12px] text-ink disabled:opacity-50"
          />
        </div>

        {/* Meeting date */}
        <div className="flex items-center gap-2">
          <label htmlFor="meeting-date" className="text-[12px] text-ink-3">
            Meeting date
          </label>
          <input
            id="meeting-date"
            type="date"
            value={meetingDate}
            disabled={busy}
            onChange={(e) => setMeetingDate(e.target.value)}
            className="rounded-[var(--radius-sm)] border border-hair bg-card px-2 py-1 text-[12px] text-ink disabled:opacity-50"
          />
        </div>

        {/* Proposed tasks */}
        {rows.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[11px] font-medium text-ink-3">Proposed tasks</p>
            {rows.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                {/* Include/exclude checkbox */}
                <input
                  type="checkbox"
                  checked={r.included}
                  disabled={busy}
                  aria-label={r.included ? `Exclude ${r.title}` : `Include ${r.title}`}
                  onChange={(e) => patch(i, { included: e.target.checked })}
                />
                {/* Title */}
                <input
                  aria-label={`Task ${i + 1} title`}
                  value={r.title}
                  disabled={busy || !r.included}
                  onChange={(e) => patch(i, { title: e.target.value })}
                  className="min-w-0 flex-1 rounded-[var(--radius-sm)] border border-hair bg-card px-2 py-1 text-[12px] text-ink disabled:opacity-50"
                />
                {/* Priority */}
                <select
                  aria-label={`Task ${i + 1} priority`}
                  value={r.priority}
                  disabled={busy || !r.included}
                  onChange={(e) => patch(i, { priority: e.target.value as Row["priority"] })}
                  className="rounded-[var(--radius-sm)] border border-hair bg-card px-1 py-1 text-[12px] text-ink disabled:opacity-50"
                >
                  <option value="low">Low</option>
                  <option value="med">Med</option>
                  <option value="high">High</option>
                </select>
                {/* Due date */}
                <input
                  type="date"
                  aria-label={`Task ${i + 1} due date`}
                  value={r.dueDate ?? ""}
                  disabled={busy || !r.included}
                  onChange={(e) => patch(i, { dueDate: e.target.value || null })}
                  className="rounded-[var(--radius-sm)] border border-hair bg-card px-1 py-1 text-[12px] text-ink disabled:opacity-50"
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center gap-2 border-t border-hair px-4 py-3">
        <span className="flex-1 text-[11px] text-ink-4">
          The full transcript will be filed to Documents &rsaquo; Transcripts.
        </span>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-[var(--radius-sm)] border border-hair px-2.5 py-1 text-[12px] text-ink-3 hover:text-ink disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="rounded-[var(--radius-sm)] bg-accent px-3 py-1 text-[12px] font-semibold text-accent-on hover:bg-accent-ink disabled:opacity-50"
        >
          Save to CRM
        </button>
      </div>
    </div>
  );
}
