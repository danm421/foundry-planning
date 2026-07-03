"use client";

import { Fragment, memo, useRef, useState } from "react";
import { useUser } from "@clerk/nextjs";

import { textareaBaseClassName } from "@/components/forms/input-styles";
import { AlertCircleIcon } from "@/components/icons";
import {
  findMentionQuery,
  insertMentionTokens,
  splitMentionSegments,
  type MentionPick,
  type MentionQuery,
} from "@/lib/crm-tasks/mentions";
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
 * Plain-text safe rendering with mention chips: split on mention tokens,
 * then split text runs on newlines. No markdown, no HTML — the surface
 * stays tiny so we don't pull in a sanitizer. Memoized so composer
 * keystrokes (which re-render the panel) don't re-segment every comment.
 */
const CommentBody = memo(function CommentBody({
  body,
  members,
  currentUserId,
}: {
  body: string;
  members: FirmMember[];
  currentUserId: string | null;
}) {
  return (
    <>
      {splitMentionSegments(body).map((seg, i) => {
        if (seg.kind === "mention") {
          const liveName =
            members.find((m) => m.userId === seg.userId)?.displayName ?? seg.displayName;
          const isSelf = currentUserId !== null && seg.userId === currentUserId;
          return (
            <span
              key={i}
              className={
                "rounded-[var(--radius-sm)] border px-1 py-px text-[12px] font-medium " +
                (isSelf
                  ? "border-accent/30 bg-accent/15 text-accent-ink"
                  : "border-hair bg-card-2 text-ink-2")
              }
            >
              @{liveName}
            </span>
          );
        }
        const lines = seg.text.split("\n");
        return (
          <Fragment key={i}>
            {lines.map((line, j) => (
              <Fragment key={j}>
                {line}
                {j < lines.length - 1 ? <br /> : null}
              </Fragment>
            ))}
          </Fragment>
        );
      })}
    </>
  );
});

export function CrmTaskSidePanelComments({
  taskId,
  initialComments,
  members,
}: CrmTaskSidePanelCommentsProps) {
  const authorName = (userId: string) =>
    members.find((m) => m.userId === userId)?.displayName ?? userId;
  const { user } = useUser();
  const currentUserId = user?.id ?? null;
  const [comments, setComments] = useState<CrmTaskComment[]>(initialComments);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [picks, setPicks] = useState<MentionPick[]>([]);
  const [mention, setMention] = useState<MentionQuery | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissedStart, setDismissedStart] = useState<number | null>(null);

  function syncMention(el: HTMLTextAreaElement) {
    const next = findMentionQuery(el.value, el.selectionStart ?? el.value.length);
    if (next?.start !== mention?.start) {
      setActiveIndex(0);
      setDismissedStart(null);
    }
    setMention(next);
  }

  const q = mention?.query.trim().toLowerCase() ?? "";
  const suggestions =
    mention && dismissedStart !== mention.start
      ? members.filter(
          (m) =>
            m.displayName.toLowerCase().includes(q) ||
            (m.email?.toLowerCase().includes(q) ?? false),
        )
      : [];
  // Zero matches = the user is typing something else; get out of the way.
  const popoverOpen = suggestions.length > 0;
  const highlighted = Math.min(activeIndex, suggestions.length - 1);

  function pickMember(m: FirmMember) {
    if (!mention) return;
    const el = textareaRef.current;
    const caret = el?.selectionStart ?? draft.length;
    const before = draft.slice(0, mention.start);
    const inserted = `@${m.displayName} `;
    setDraft(before + inserted + draft.slice(caret));
    setPicks((prev) =>
      prev.some((p) => p.userId === m.userId)
        ? prev
        : [...prev, { displayName: m.displayName, userId: m.userId }],
    );
    setMention(null);
    setActiveIndex(0);
    const nextCaret = (before + inserted).length;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(nextCaret, nextCaret);
    });
  }

  async function post() {
    const body = insertMentionTokens(draft.trim(), picks);
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
      setPicks([]);
      setMention(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Post failed");
    } finally {
      setPosting(false);
    }
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (popoverOpen && !e.metaKey && !e.ctrlKey) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((highlighted + 1) % suggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((highlighted - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        pickMember(suggestions[highlighted]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setDismissedStart(mention?.start ?? null);
        return;
      }
    }
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
                  <CommentBody body={c.bodyMarkdown} members={members} currentUserId={currentUserId} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2 border-t border-hair pt-3">
        <div className="relative">
          {popoverOpen && (
            <div className="absolute bottom-full left-0 right-0 z-30 mb-1 overflow-hidden rounded-[var(--radius-sm)] border border-hair bg-card shadow-lg">
              <ul role="listbox" aria-label="Mention a member" className="max-h-56 overflow-y-auto py-1">
                {suggestions.map((m, i) => (
                  <li key={m.userId}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={i === highlighted}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pickMember(m)}
                      className={
                        "block w-full px-3 py-1.5 text-left text-[13px] " +
                        (i === highlighted ? "bg-card-2 text-ink" : "text-ink-2 hover:bg-card-2")
                      }
                    >
                      <span className="block truncate">{m.displayName}</span>
                      {m.email && (
                        <span className="block truncate text-[11px] text-ink-3">{m.email}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <textarea
            ref={textareaRef}
            rows={3}
            maxLength={20_000}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              syncMention(e.target);
            }}
            onSelect={(e) => syncMention(e.currentTarget)}
            onKeyDown={onKey}
            placeholder="Write a comment. @ to mention. Cmd/Ctrl+Enter to post."
            className={`${textareaBaseClassName} w-full text-[13px]`}
          />
        </div>
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
