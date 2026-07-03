"use client";

import { Fragment, useState } from "react";

import { textareaBaseClassName } from "@/components/forms/input-styles";
import { AlertCircleIcon } from "@/components/icons";
import type { FirmMember } from "@/lib/crm-tasks/members";

export interface CrmTaskComment {
  id: string;
  authorUserId: string;
  bodyMarkdown: string;
  createdAt: string;
}

interface CrmTaskSidePanelCommentsProps {
  taskId: string;
  initialComments: CrmTaskComment[];
  /** Firm members used to resolve comment author ids to display names. */
  members: FirmMember[];
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "";
  const sec = Math.round(ms / 1000);
  if (sec < 60) return sec <= 1 ? "just now" : `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.round(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  const yr = Math.round(mo / 12);
  return `${yr}y ago`;
}

/**
 * Plain-text safe rendering: split on newlines and join with `<br />`
 * fragments. No markdown, no HTML — v1 keeps the surface tiny so we
 * don't pull in a sanitizer.
 */
function renderBody(body: string) {
  const lines = body.split("\n");
  return (
    <>
      {lines.map((line, i) => (
        <Fragment key={i}>
          {line}
          {i < lines.length - 1 ? <br /> : null}
        </Fragment>
      ))}
    </>
  );
}

export function CrmTaskSidePanelComments({
  taskId,
  initialComments,
  members,
}: CrmTaskSidePanelCommentsProps) {
  const authorName = (userId: string) =>
    members.find((m) => m.userId === userId)?.displayName ?? userId;
  const [comments, setComments] = useState<CrmTaskComment[]>(initialComments);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function post() {
    const body = draft.trim();
    if (!body || posting) return;
    setPosting(true);
    setError(null);
    try {
      const res = await fetch(`/api/crm/tasks/${taskId}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bodyMarkdown: body }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(
          typeof j.error === "string" ? j.error : `Post failed (${res.status})`,
        );
      }
      const { comment } = (await res.json()) as { comment: CrmTaskComment };
      setComments((prev) => [...prev, comment]);
      setDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Post failed");
    } finally {
      setPosting(false);
    }
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void post();
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {comments.length === 0 ? (
          <div className="rounded-[var(--radius)] border border-dashed border-hair bg-card-2 px-4 py-8 text-center">
            <p className="text-[13px] text-ink-3">No comments yet.</p>
          </div>
        ) : (
          <ul className="space-y-2.5">
            {comments.map((c) => (
              <li
                key={c.id}
                className="rounded-[var(--radius)] border border-hair bg-card p-3"
              >
                <div className="flex items-baseline justify-between gap-3 text-[11px] text-ink-3">
                  <span className="font-medium text-ink-2">{authorName(c.authorUserId)}</span>
                  <time dateTime={c.createdAt} title={new Date(c.createdAt).toLocaleString()}>
                    {relativeTime(c.createdAt)}
                  </time>
                </div>
                <div className="mt-1.5 text-[13px] text-ink whitespace-normal break-words">
                  {renderBody(c.bodyMarkdown)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2 border-t border-hair pt-3">
        <textarea
          rows={3}
          maxLength={20_000}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          placeholder="Write a comment. Cmd/Ctrl+Enter to post."
          className={`${textareaBaseClassName} w-full text-[13px]`}
        />
        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-crit/30 bg-crit/10 px-2.5 py-1.5 text-[12px] text-crit"
          >
            <AlertCircleIcon width={14} height={14} className="mt-0.5 shrink-0" aria-hidden />
            <span>{error}</span>
          </div>
        )}
        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={post}
            disabled={posting || draft.trim().length === 0}
            className="inline-flex h-8 items-center rounded-[var(--radius-sm)] bg-accent px-3 text-[12px] font-semibold text-accent-on hover:bg-accent-ink disabled:opacity-50"
          >
            {posting ? "Posting…" : "Post"}
          </button>
        </div>
      </div>
    </div>
  );
}
