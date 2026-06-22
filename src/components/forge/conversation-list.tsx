// src/components/forge/conversation-list.tsx
// Presentational component — no data fetching, no server calls.
// All IO happens through callbacks.
"use client";

import { useState } from "react";

export type ConversationThread = {
  id: string;
  title: string;
  updatedAt?: Date | string;
};

interface ConversationListProps {
  threads: ConversationThread[];
  activeId: string | null | undefined;
  onSelect: (id: string) => void;
  onRename: (id: string, newTitle: string) => void;
  onDelete: (id: string) => void;
}

export function ConversationList({
  threads,
  activeId,
  onSelect,
  onRename,
  onDelete,
}: ConversationListProps) {
  const [filter, setFilter] = useState("");
  // threadId → edit buffer (null = not editing)
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const lower = filter.toLowerCase();
  const visible = filter
    ? threads.filter((t) => t.title.toLowerCase().includes(lower))
    : threads;

  function openRename(id: string, title: string) {
    setRenaming(id);
    setRenameValue(title);
  }

  function commitRename(id: string) {
    const trimmed = renameValue.trim();
    if (trimmed) onRename(id, trimmed);
    setRenaming(null);
  }

  function cancelRename() {
    setRenaming(null);
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      {/* Filter input */}
      <div className="px-1">
        <input
          type="text"
          aria-label="Filter conversations"
          placeholder="Filter…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-full rounded-[var(--radius-sm)] border border-hair bg-card-2 px-2 py-1 text-[12px] text-ink placeholder:text-ink-4 focus:outline-none focus:border-secondary/50"
        />
      </div>

      {/* Thread list */}
      <ul role="list" className="flex flex-col gap-px">
        {visible.map((thread) => {
          const isActive = thread.id === activeId;
          const isEditing = renaming === thread.id;

          return (
            <li key={thread.id}>
              {isEditing ? (
                /* Inline rename row */
                <div className="flex items-center gap-1 rounded-[var(--radius-sm)] border border-secondary/40 bg-card-2 px-2 py-1">
                  <input
                    type="text"
                    aria-label="Rename conversation"
                    value={renameValue}
                    autoFocus
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename(thread.id);
                      if (e.key === "Escape") cancelRename();
                    }}
                    className="min-w-0 flex-1 bg-transparent text-[12px] text-ink focus:outline-none"
                  />
                  <button
                    type="button"
                    aria-label="Save"
                    onClick={() => commitRename(thread.id)}
                    className="shrink-0 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[11px] font-medium text-secondary-ink hover:bg-secondary/20"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    aria-label="Cancel rename"
                    onClick={cancelRename}
                    className="shrink-0 text-[11px] text-ink-4 hover:text-ink"
                  >
                    ×
                  </button>
                </div>
              ) : (
                /* Normal thread row */
                <div
                  data-testid={`thread-item-${thread.id}`}
                  aria-current={isActive ? "true" : undefined}
                  data-active={isActive ? "true" : undefined}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelect(thread.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") onSelect(thread.id);
                  }}
                  className={`group flex min-w-0 cursor-pointer items-center gap-1 rounded-[var(--radius-sm)] px-2 py-1 text-[12px] transition-colors ${
                    isActive
                      ? "bg-secondary/15 text-ink"
                      : "text-ink-2 hover:bg-card-hover hover:text-ink"
                  }`}
                >
                  {/* Title + timestamp */}
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{thread.title}</div>
                    {thread.updatedAt && (
                      <time
                        dateTime={
                          thread.updatedAt instanceof Date
                            ? thread.updatedAt.toISOString()
                            : String(thread.updatedAt)
                        }
                        className="block text-[10px] text-ink-4"
                      >
                        {relativeTime(thread.updatedAt)}
                      </time>
                    )}
                  </div>

                  {/* Action buttons — visible on hover / focus-within */}
                  <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                    <button
                      type="button"
                      aria-label={`Rename ${thread.title}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        openRename(thread.id, thread.title);
                      }}
                      className="flex h-5 w-5 items-center justify-center rounded text-ink-3 hover:bg-card-hover hover:text-ink"
                    >
                      {/* Pencil icon — inline SVG, no lucide-react dep */}
                      <svg
                        aria-hidden
                        width="11"
                        height="11"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={1.8}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${thread.title}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(thread.id);
                      }}
                      className="flex h-5 w-5 items-center justify-center rounded text-ink-3 hover:bg-crit/10 hover:text-crit"
                    >
                      {/* Trash icon — inline SVG */}
                      <svg
                        aria-hidden
                        width="11"
                        height="11"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={1.8}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                        <path d="M10 11v6M14 11v6" />
                        <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                      </svg>
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Returns a compact relative-time string without adding a library. */
function relativeTime(date: Date | string): string {
  const d = date instanceof Date ? date : new Date(date);
  const diffMs = Date.now() - d.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
