"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

import DialogTabs, { type DialogTab } from "./dialog-tabs";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";

export type CrmTaskStatus = "open" | "in_progress" | "blocked" | "done";
export type CrmTaskPriority = "low" | "med" | "high";

export interface CrmTaskSidePanelTask {
  id: string;
  title: string;
  status: CrmTaskStatus;
  priority: CrmTaskPriority;
}

type TabId = "details" | "comments" | "activity" | "files";

const TABS: DialogTab[] = [
  { id: "details", label: "Details" },
  { id: "comments", label: "Comments" },
  { id: "activity", label: "Activity" },
  { id: "files", label: "Files" },
];

const STATUS_PILL_CLASS: Record<CrmTaskStatus, string> = {
  open: "border-hair-2 text-ink-2",
  in_progress: "border-accent-deep text-accent",
  blocked: "border-crit text-crit",
  done: "border-hair text-ink-3",
};

const STATUS_LABEL: Record<CrmTaskStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  blocked: "Blocked",
  done: "Done",
};

const PRIORITY_DOT_CLASS: Record<CrmTaskPriority, string> = {
  high: "bg-crit",
  med: "bg-warn",
  low: "bg-ink-4",
};

const PRIORITY_LABEL: Record<CrmTaskPriority, string> = {
  high: "High priority",
  med: "Medium priority",
  low: "Low priority",
};

interface CrmTaskSidePanelProps {
  taskId: string;
  initialTask: CrmTaskSidePanelTask;
  /** Body slots — caller renders the four tab bodies. The panel owns
   *  active-tab state and shows only the active one. */
  detailsTab: ReactNode;
  commentsTab: ReactNode;
  activityTab: ReactNode;
  filesTab: ReactNode;
}

/**
 * Right-edge slide-over panel for a single CRM task. Owns:
 *  - The header (inline-editable title, status pill, priority dot, close).
 *  - The tabs strip + active-tab state.
 *  - Backdrop click + escape-to-close, body scroll lock, focus on open.
 *  - URL cleanup on close (removes `?task=` so refreshing doesn't reopen).
 *
 * Each tab's actual body is passed in by the page wrapper as a server-
 * rendered ReactNode so the panel itself stays focused on chrome.
 */
export function CrmTaskSidePanel({
  taskId,
  initialTask,
  detailsTab,
  commentsTab,
  activityTab,
  filesTab,
}: CrmTaskSidePanelProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [activeTab, setActiveTab] = useState<TabId>("details");
  const [title, setTitle] = useState(initialTask.title);
  const [editingTitle, setEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState(initialTask.title);
  const [titleError, setTitleError] = useState<string | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);

  function close() {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("task");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !editingTitle) close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // We intentionally re-bind whenever editingTitle flips so escape
    // doesn't close the panel while the user is mid-edit on the title.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingTitle]);

  // Ref-counted so it composes with any dialog scroll-lock that's also active
  // (see use-body-scroll-lock.ts).
  useBodyScrollLock(true);

  useEffect(() => {
    surfaceRef.current?.focus();
  }, []);

  async function saveTitle(next: string) {
    const trimmed = next.trim();
    if (!trimmed) {
      setTitleError("Title cannot be empty");
      return;
    }
    if (trimmed === title) {
      setEditingTitle(false);
      return;
    }
    setTitleError(null);
    try {
      const res = await fetch(`/api/crm/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ field: "title", value: trimmed }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(
          typeof j.error === "string" ? j.error : `Save failed (${res.status})`,
        );
      }
      setTitle(trimmed);
      setEditingTitle(false);
      router.refresh();
    } catch (err) {
      setTitleError(err instanceof Error ? err.message : "Save failed");
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div
        data-testid="task-panel-backdrop"
        onClick={close}
        className="absolute inset-0 bg-paper/70"
      />
      <div
        ref={surfaceRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Task: ${title}`}
        tabIndex={-1}
        className="relative z-10 flex h-full w-full flex-col border-l border-hair-2 bg-card-2 outline-none sm:w-[560px]"
      >
        <div className="flex items-start gap-3 border-b border-hair-2 px-5 py-4">
          <span
            aria-label={PRIORITY_LABEL[initialTask.priority]}
            title={PRIORITY_LABEL[initialTask.priority]}
            className={`mt-2.5 inline-block h-[9px] w-[9px] shrink-0 rounded-full ${PRIORITY_DOT_CLASS[initialTask.priority]}`}
          />
          <div className="min-w-0 flex-1">
            {editingTitle ? (
              <input
                autoFocus
                defaultValue={title}
                maxLength={200}
                onChange={(e) => setDraftTitle(e.target.value)}
                onBlur={(e) => void saveTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void saveTitle(draftTitle);
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    setDraftTitle(title);
                    setEditingTitle(false);
                    setTitleError(null);
                  }
                }}
                className="w-full rounded-[var(--radius-sm)] border border-hair-2 bg-paper px-2 py-1 text-[19px] font-semibold text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
              />
            ) : (
              <button
                type="button"
                onClick={() => {
                  setDraftTitle(title);
                  setEditingTitle(true);
                }}
                className="block w-full rounded-[var(--radius-sm)] px-2 py-1 text-left text-[19px] font-semibold leading-tight text-ink transition-colors duration-150 hover:bg-card-hover"
              >
                {title}
              </button>
            )}
            {titleError && (
              <p role="alert" className="mt-1 px-2 text-[11px] text-crit">
                {titleError}
              </p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2.5 px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-3">
              <span
                className={
                  "inline-flex items-center rounded-[var(--radius-sm)] border px-2 py-0.5 " +
                  STATUS_PILL_CLASS[initialTask.status]
                }
              >
                {STATUS_LABEL[initialTask.status]}
              </span>
              <span>{PRIORITY_LABEL[initialTask.priority]}</span>
              <span aria-hidden="true" className="text-ink-4">
                /
              </span>
              <span className="tabular normal-case tracking-[0.06em]">{initialTask.id}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-hair-2 text-ink-3 transition-colors duration-150 hover:border-hair-3 hover:text-ink"
          >
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>

        <DialogTabs
          tabs={TABS}
          activeTab={activeTab}
          onTabChange={(id) => setActiveTab(id as TabId)}
        />

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {activeTab === "details" && detailsTab}
          {activeTab === "comments" && commentsTab}
          {activeTab === "activity" && activityTab}
          {activeTab === "files" && filesTab}
        </div>
      </div>
    </div>
  );
}
