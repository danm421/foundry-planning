// src/components/copilot/copilot-panel.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { sectionKeyForPath } from "@/lib/back-nav";
import { useCopilot } from "./copilot-provider";
import { useScenarioDrawerOptional } from "@/components/scenario/scenario-drawer-provider";
import { useCopilotStream, type PendingApproval } from "./use-copilot-stream";
import { ApprovalCard } from "./approval-card";
import { MarkdownMessage } from "./markdown-message";
import { SparkIcon } from "./spark-icon";
import { listMyConversations, loadConversationMessages } from "./actions";
import { useCopilotImport, type CopilotImportResult } from "./use-copilot-import";
import { ImportSummaryCard } from "./import-summary-card";

// Mirrors ScenarioDrawer's explicit width — the CSS slide transition needs a
// concrete translateX distance, so the px width can't live in Tailwind alone.
const PANEL_WIDTH = 420;

type Thread = { id: string; title: string; updatedAt?: Date | string };

interface CopilotPanelProps {
  clientId: string;
  /** Scenario id → display name, for the scenario context chip. */
  scenarioNames: Record<string, string>;
  /** Test-only: render the panel open without the provider toggle. */
  forceOpenForTest?: boolean;
}

export function CopilotPanel({ clientId, scenarioNames, forceOpenForTest }: CopilotPanelProps) {
  const { scenarioId, pathname, isOpen, close } = useCopilot();
  const drawer = useScenarioDrawerOptional();
  const open = forceOpenForTest || isOpen;

  const {
    messages,
    setMessages,
    toolStatus,
    pendingApproval,
    setPendingApproval,
    status,
    errorMessage,
    conversationId,
    setConversationId,
    send,
    cancel,
    resume,
  } = useCopilotStream(clientId);

  const [threads, setThreads] = useState<Thread[]>([]);
  const [input, setInput] = useState("");
  const [loadingThread, setLoadingThread] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [attached, setAttached] = useState<File[]>([]);
  const [pendingImportId, setPendingImportId] = useState<string | undefined>();
  const [importResult, setImportResult] = useState<CopilotImportResult | null>(null);
  const { status: importStatus, errorMessage: importError, runImport } = useCopilotImport();
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
  // copilot is open, close the copilot (the provider handles the inverse).
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
    // Send-with-files: run the import pipeline instead of a chat turn.
    if (attached.length > 0) {
      const files = attached;
      setAttached([]);
      setInput("");
      setImportResult(null); // clear any prior summary before a new run
      const result = await runImport(clientId, files);
      if (result) {
        setPendingImportId(result.importId);
        setImportResult(result);
      }
      return;
    }
    const msg = input.trim();
    if (!msg) return;
    setInput("");
    // scenarioId + pathname are re-read every render → current scope per turn.
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
    setAttached((prev) => [...prev, ...Array.from(list)]);
  }

  const lastMsg = messages[messages.length - 1];
  const streamingEmpty = busy && lastMsg?.role === "assistant" && lastMsg.text === "";
  const scenarioLabel = scenarioId ? scenarioNames[scenarioId] ?? "Scenario" : "Base case";
  const pageLabel = sectionKeyForPath(pathname);

  return (
    <div
      id="copilot-panel"
      role="complementary"
      aria-label="Foundry Copilot"
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
        {/* Header + context chips */}
        <div className="flex items-center justify-between gap-2 border-b border-hair px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-secondary-wash text-secondary-ink">
              <SparkIcon />
            </span>
            <span className="text-[13px] font-semibold text-ink">Copilot</span>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close copilot"
            className="flex h-7 w-7 items-center justify-center rounded text-ink-3 hover:bg-card-hover hover:text-ink"
          >
            <span aria-hidden className="text-base leading-none">×</span>
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5 border-b border-hair px-4 py-2">
          <Chip testid="chip-client" label="Client" value={clientId.slice(0, 8)} />
          <Chip testid="chip-scenario" label="Scenario" value={scenarioLabel} />
          <Chip testid="chip-page" label="Page" value={pageLabel} />
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
                  {isUser ? m.text : isStreamingThis ? <TypingDots /> : <MarkdownMessage text={m.text} />}
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
            <ImportSummaryCard
              clientId={clientId}
              importId={importResult.importId}
              summary={importResult.summary}
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
            <div className="mb-2 flex flex-wrap gap-1.5">
              {attached.map((f, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 rounded-full border border-hair bg-card-2 px-2 py-0.5 text-[11px] text-ink-2"
                >
                  {f.name}
                  <button
                    type="button"
                    aria-label={`Remove ${f.name}`}
                    onClick={() => setAttached((prev) => prev.filter((_, j) => j !== i))}
                    className="text-ink-4 hover:text-ink"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          <input
            ref={fileInputRef}
            data-testid="copilot-file-input"
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
              <span aria-hidden className="text-sm">＋</span>
            </button>
            <textarea
              aria-label="Ask the copilot"
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

function Chip({ testid, label, value }: { testid: string; label: string; value: string }) {
  return (
    <span
      data-testid={testid}
      className="inline-flex items-center gap-1 rounded-full border border-hair bg-card-2 px-2 py-0.5 text-[11px] text-ink-3"
    >
      <span className="text-ink-4">{label}:</span>
      <span className="text-ink-2">{value}</span>
    </span>
  );
}

function TypingDots() {
  return (
    <div className="flex items-center gap-1 py-1" aria-label="Copilot is typing">
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-4 [animation-delay:-0.3s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-4 [animation-delay:-0.15s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-4" />
    </div>
  );
}

