// src/components/forge/forge-panel.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { sectionKeyForPath } from "@/lib/back-nav";
import { useForge } from "./forge-provider";
import { useScenarioDrawerOptional } from "@/components/scenario/scenario-drawer-provider";
import { useForgeStream, type PendingApproval } from "./use-forge-stream";
import { ApprovalCard } from "./approval-card";
import { MarkdownMessage } from "./markdown-message";
import { SparkIcon } from "./spark-icon";
import { listMyConversations, loadConversationMessages } from "./actions";
import { useForgeImport, type ForgeImportResult } from "./use-forge-import";
import { ImportReviewLink } from "./import-review-link";

// Mirrors ScenarioDrawer's explicit width — the CSS slide transition needs a
// concrete translateX distance, so the px width can't live in Tailwind alone.
const PANEL_WIDTH = 420;

type Thread = { id: string; title: string; updatedAt?: Date | string };

interface ForgePanelProps {
  clientId: string;
  /** Household display name (e.g. "Jane & John Smith") for the context line. */
  clientName: string;
  /** Scenario id → display name, for the scenario context line. */
  scenarioNames: Record<string, string>;
  /** Test-only: render the panel open without the provider toggle. */
  forceOpenForTest?: boolean;
}

export function ForgePanel({
  clientId,
  clientName,
  scenarioNames,
  forceOpenForTest,
}: ForgePanelProps) {
  const { scenarioId, pathname, isOpen, close } = useForge();
  const drawer = useScenarioDrawerOptional();
  const open = forceOpenForTest || isOpen;

  const {
    messages,
    setMessages,
    toolStatus,
    isVerifying,
    pendingApproval,
    setPendingApproval,
    status,
    errorMessage,
    conversationId,
    setConversationId,
    send,
    cancel,
    resume,
  } = useForgeStream(clientId);

  const [threads, setThreads] = useState<Thread[]>([]);
  const [input, setInput] = useState("");
  const [loadingThread, setLoadingThread] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [attached, setAttached] = useState<File[]>([]);
  const [pendingImportId, setPendingImportId] = useState<string | undefined>();
  const [importResult, setImportResult] = useState<ForgeImportResult | null>(null);
  const { status: importStatus, errorMessage: importError, runImport } = useForgeImport();
  const importing =
    importStatus === "creating" ||
    importStatus === "uploading" ||
    importStatus === "extracting" ||
    importStatus === "matching";
  const scrollRef = useRef<HTMLDivElement>(null);
  const busy = status === "streaming";
  // While an approval is pending the graph is checkpointed mid-interrupt; the
  // only valid next step is Confirm/Cancel on the ApprovalCard (→ /resume).
  // Sending a fresh /stream turn here would re-enter the interrupted node and
  // corrupt the pending proposal, so lock the composer until it resolves.
  // (busy alone isn't enough: the stream emits `approval_required` then `done`,
  // so status is "done" — not "streaming" — while the card is up.)
  const locked = busy || pendingApproval != null || importing;

  // Mutual exclusion belt-and-braces: if the scenario drawer opens while the
  // forge is open, close the forge (the provider handles the inverse).
  useEffect(() => {
    if (open && drawer?.open) close();
  }, [open, drawer?.open, close]);

  // Esc closes the panel (matches ScenarioDrawer).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  // Load the thread list once the panel opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    listMyConversations()
      .then((t) => !cancelled && setThreads(t as Thread[]))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Keep the latest bubble in view as it streams.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && typeof el.scrollTo === "function") {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, [messages, toolStatus, pendingApproval, loadingThread]);

  function newChat() {
    if (busy) return;
    setConversationId(undefined);
    setMessages([]);
    setPendingApproval(null);
    setPendingImportId(undefined);
    setImportResult(null);
    setInput("");
  }

  async function selectThread(id: string) {
    if (busy || loadingThread || id === conversationId) return;
    setLoadingThread(true);
    setPendingApproval(null);
    setPendingImportId(undefined);
    setImportResult(null);
    try {
      const { messages: loaded, approval } = await loadConversationMessages(id);
      setConversationId(id);
      setMessages(loaded);
      if (approval) setPendingApproval(approval as PendingApproval);
    } finally {
      setLoadingThread(false);
    }
  }

  async function onSend() {
    if (locked) return;
    // Send-with-files: run the import pipeline, then immediately engage the agent.
    if (attached.length > 0) {
      const files = attached;
      const prompt = input.trim(); // may be empty — the attachment is the turn
      setAttached([]);
      setInput("");
      setImportResult(null); // clear any prior summary before a new run
      const result = await runImport(clientId, files);
      if (!result) return; // importError bubble already shown by the hook
      setPendingImportId(result.importId);
      setImportResult(result);
      // Fire one chat turn so Forge reads the import and responds right away.
      // send() pushes the user bubble itself — do not push one here.
      await send({
        message: prompt,
        scenarioId: scenarioId ?? "base",
        conversationId,
        currentPage: sectionKeyForPath(pathname),
        pendingImportId: result.importId,
        attachments: files.map((f) => f.name),
      });
      listMyConversations()
        .then((t) => setThreads(t as Thread[]))
        .catch(() => {});
      return;
    }
    const msg = input.trim();
    if (!msg) return;
    setInput("");
    await send({
      message: msg,
      scenarioId: scenarioId ?? "base",
      conversationId,
      currentPage: sectionKeyForPath(pathname),
      pendingImportId,
    });
    listMyConversations()
      .then((t) => setThreads(t as Thread[]))
      .catch(() => {});
  }

  function onPickFiles(list: FileList | null) {
    if (!list) return;
    // Snapshot the files synchronously. `e.target.files` is a *live* FileList,
    // and the input's onChange resets `value = ""` (to allow re-picking the same
    // file) right after this call — which empties that FileList in place. React
    // may run the setAttached updater deferred (StrictMode/concurrent), so a
    // `...Array.from(list)` inside the updater would read the now-empty list and
    // drop the attachment. Capturing here, before value="", keeps it stable.
    const files = Array.from(list);
    setAttached((prev) => [...prev, ...files]);
  }

  const lastMsg = messages[messages.length - 1];
  const streamingEmpty = busy && lastMsg?.role === "assistant" && lastMsg.text === "";
  const scenarioLabel = scenarioId ? scenarioNames[scenarioId] ?? "Scenario" : "Base case";
  const pageLabel = pageLabelForPath(pathname);

  return (
    <div
      id="forge-panel"
      role="complementary"
      aria-label="Forge"
      // z-30: the same right-panel layer as ScenarioDrawer — above page
      // content, below the topbar (z-40) and client header (z-[35]).
      className="fixed right-0 top-[100px] z-30 h-[calc(100vh-100px)] border-l border-hair bg-card shadow-[-4px_0_16px_rgba(0,0,0,0.18)]"
      style={{
        width: PANEL_WIDTH,
        transform: open ? "translateX(0)" : `translateX(${PANEL_WIDTH}px)`,
        transition: "transform 0.22s ease",
      }}
      // Off-screen panel stays out of the tab order / AT tree when closed.
      inert={open ? undefined : true}
    >
      <div className="flex h-full flex-col">
        {/* Header + context line */}
        <div className="flex items-center justify-between gap-2 border-b border-hair px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-secondary-wash text-secondary-ink">
              <SparkIcon />
            </span>
            <span className="text-[13px] font-semibold text-ink">Forge</span>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close Forge"
            className="flex h-7 w-7 items-center justify-center rounded text-ink-3 hover:bg-card-hover hover:text-ink"
          >
            <span aria-hidden className="text-base leading-none">×</span>
          </button>
        </div>

        {/* Context line — who/what/where Forge is scoped to. Humanized: client
            name, scenario, and a friendly page label (no raw IDs or route keys). */}
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 border-b border-hair px-4 py-2 text-[11px] text-ink-3">
          <span data-testid="chip-client" className="text-ink-2">{clientName}</span>
          <span aria-hidden className="text-ink-4">·</span>
          <span data-testid="chip-scenario" className="text-ink-2">{scenarioLabel}</span>
          <span aria-hidden className="text-ink-4">·</span>
          <span data-testid="chip-page" className="text-ink-2">{pageLabel}</span>
        </div>

        {/* Thread row */}
        <div className="flex items-center gap-2 border-b border-hair px-4 py-2">
          <button
            type="button"
            onClick={newChat}
            disabled={busy}
            className="rounded-[var(--radius-sm)] border border-secondary/40 bg-secondary-wash px-2.5 py-1 text-[12px] font-medium text-secondary-ink hover:bg-secondary/20 disabled:opacity-50"
          >
            + New chat
          </button>
          {threads.length > 0 && (
            <select
              aria-label="Conversation history"
              value={conversationId ?? ""}
              onChange={(e) => e.target.value && selectThread(e.target.value)}
              disabled={busy || loadingThread}
              className="min-w-0 flex-1 truncate rounded-[var(--radius-sm)] border border-hair bg-card-2 px-2 py-1 text-[12px] text-ink-2 disabled:opacity-60"
            >
              <option value="">Recent conversations…</option>
              {threads.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {loadingThread && <p className="text-[13px] text-ink-3">Loading conversation…</p>}

          {!loadingThread && messages.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary-wash text-secondary-ink">
                <SparkIcon />
              </span>
              <p className="text-[13px] font-medium text-ink">How can I help?</p>
              <p className="max-w-[16rem] text-[12px] text-ink-3">
                Ask me to explain the plan, run the numbers, or compare scenarios. I only report
                figures from the engine — never invented numbers.
              </p>
            </div>
          )}

          {messages.map((m, i) => {
            const isUser = m.role === "user";
            const isStreamingThis = streamingEmpty && i === messages.length - 1;
            return (
              <div key={i} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                <div
                  className={
                    isUser
                      ? "min-w-0 max-w-[85%] rounded-[var(--radius)] rounded-br-sm bg-secondary px-3 py-2 text-[13px] leading-relaxed text-secondary-on [overflow-wrap:anywhere] whitespace-pre-wrap"
                      : "min-w-0 max-w-[90%] rounded-[var(--radius)] rounded-bl-sm border border-hair bg-card-2 px-3 py-2"
                  }
                >
                  {isUser ? (
                    <>
                      {m.attachments && m.attachments.length > 0 && (
                        <div className="mb-1 flex flex-wrap gap-1">
                          {m.attachments.map((name, k) => (
                            <span
                              key={k}
                              className="inline-flex items-center gap-1 rounded-full bg-secondary-ink/30 px-2 py-0.5 text-[11px]"
                            >
                              📎 {name}
                            </span>
                          ))}
                        </div>
                      )}
                      {m.text && <span>{m.text}</span>}
                    </>
                  ) : isStreamingThis ? (
                    <TypingDots />
                  ) : (
                    <MarkdownMessage text={m.text} />
                  )}
                </div>
              </div>
            );
          })}

          {/* Tool affordance, e.g. "Running run_monte_carlo…" */}
          {toolStatus && (
            <div className="flex items-center gap-2 text-[12px] text-secondary-ink" aria-live="polite">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-secondary" />
              Running {toolStatus.replace(/_/g, " ")}…
            </div>
          )}

          {isVerifying && (
            <div className="flex items-center gap-2 text-[12px] text-secondary-ink" aria-live="polite">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-secondary" />
              Checking the numbers…
            </div>
          )}

          {importing && (
            <div className="flex items-center gap-2 text-[12px] text-secondary-ink" aria-live="polite">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-secondary" />
              {importStatus === "creating" && "Starting import…"}
              {importStatus === "uploading" && "Uploading document…"}
              {importStatus === "extracting" && "Extracting data…"}
              {importStatus === "matching" && "Matching against existing accounts…"}
            </div>
          )}

          {importResult && (
            <ImportReviewLink
              clientId={clientId}
              importId={importResult.importId}
              warnings={importResult.warnings}
            />
          )}

          {importError && (
            <div className="rounded-[var(--radius-sm)] border border-crit/40 bg-crit/10 px-3 py-2 text-[12px] text-crit">
              {importError}
            </div>
          )}

          {/* Phase-2: render the real ApprovalCard when approval is pending.
              key= per approval round so verdict state resets on each new payload. */}
          {pendingApproval && (
            <ApprovalCard
              key={pendingApproval.calls.map((c) => c.id).join("|") || "approval"}
              previews={pendingApproval.previews}
              calls={pendingApproval.calls}
              busy={status === "streaming"}
              onSubmit={(decisions) => resume(decisions)}
              onCancel={() => {
                const rejectAll: Record<string, "confirm" | "reject"> = {};
                for (const c of pendingApproval.calls) rejectAll[c.id] = "reject";
                resume(rejectAll);
              }}
            />
          )}

          {status === "error" && errorMessage && (
            <div className="rounded-[var(--radius-sm)] border border-crit/40 bg-crit/10 px-3 py-2 text-[12px] text-crit">
              {errorMessage}
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="border-t border-hair px-4 py-3">
          {attached.length > 0 && (
            <div className="mb-2 space-y-1.5">
              {attached.map((f, i) => (
                <div
                  key={i}
                  data-testid="forge-attachment"
                  className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-hair bg-card-2 px-2.5 py-1.5"
                >
                  <svg
                    aria-hidden
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="shrink-0 text-ink-3"
                  >
                    <path d="M14 3v4a1 1 0 0 0 1 1h4" />
                    <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" />
                  </svg>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-ink">{f.name}</span>
                  <span className="shrink-0 text-[11px] text-ink-4">{formatBytes(f.size)}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${f.name}`}
                    onClick={() => setAttached((prev) => prev.filter((_, j) => j !== i))}
                    className="shrink-0 text-ink-4 hover:text-ink"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          <input
            ref={fileInputRef}
            data-testid="forge-file-input"
            type="file"
            multiple
            accept=".pdf,.xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              onPickFiles(e.target.files);
              e.target.value = ""; // allow re-selecting the same file
            }}
          />
          <div className="flex items-end gap-2 rounded-[var(--radius)] border border-hair bg-card-2 p-1.5 focus-within:border-secondary/50">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={locked}
              aria-label="Attach a document"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-hair text-ink-2 hover:text-ink disabled:opacity-40"
            >
              {/* Inline Lucide-style paperclip — lucide-react isn't a repo dep
                  (see theme-toggle.tsx); outline, 1.5 stroke, currentColor. */}
              <svg
                aria-hidden
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            </button>
            <textarea
              aria-label="Ask Forge"
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void onSend();
                }
              }}
              placeholder={pendingApproval ? "Confirm or cancel the proposed change above…" : "Ask about this plan…"}
              disabled={locked}
              className="min-w-0 flex-1 resize-none bg-transparent px-2 py-1.5 text-[13px] text-ink placeholder:text-ink-4 focus:outline-none disabled:opacity-50"
            />
            {busy ? (
              <button
                type="button"
                onClick={cancel}
                aria-label="Stop"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-hair text-ink-2 hover:text-ink"
              >
                <span aria-hidden className="text-xs">■</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void onSend()}
                disabled={(!input.trim() && attached.length === 0) || locked}
                aria-label="Send message"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-secondary text-secondary-on hover:bg-secondary-ink disabled:opacity-40"
              >
                <span aria-hidden className="text-sm">↑</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Client sub-page segments that don't title-case cleanly from their slug. */
const CLIENT_PAGE_LABELS: Record<string, string> = {
  cashflow: "Cash Flow",
  "income-expenses": "Income & Expenses",
};

/**
 * Human-readable label for the current page, for the context line. Turns a
 * route into something an advisor would recognize ("Balance Sheet"), never a
 * raw key like `client:UUID`. The panel only ever mounts under `/clients/[id]`,
 * so the client-sub-page branch is the live path; the rest degrades gracefully.
 */
function pageLabelForPath(pathname: string): string {
  const parts = pathname.split("/").filter(Boolean); // ["clients", id, section?, …]
  if (parts[0] !== "clients" || !parts[1]) {
    const seg = parts[0];
    return seg ? seg.charAt(0).toUpperCase() + seg.slice(1) : "Overview";
  }
  const section = parts[2];
  if (!section) return "Overview"; // /clients/[id] root
  return (
    CLIENT_PAGE_LABELS[section] ??
    section
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ")
  );
}

/** Compact human-readable file size for attachment cards (e.g. "12 KB", "3.4 MB"). */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function TypingDots() {
  return (
    <div className="flex items-center gap-1 py-1" aria-label="Forge is typing">
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-4 [animation-delay:-0.3s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-4 [animation-delay:-0.15s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-4" />
    </div>
  );
}

