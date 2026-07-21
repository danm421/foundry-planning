// src/components/forge/forge-panel.tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { sectionKeyForPath } from "@/lib/back-nav";
import { useForge } from "./forge-provider";
import { useWalkthrough } from "./walkthrough-context";
import { useScenarioDrawerOptional } from "@/components/scenario/scenario-drawer-provider";
import { useForgeStream, type PendingApproval } from "./use-forge-stream";
import { ApprovalCard } from "./approval-card";
import { looksLikeTranscript } from "./detect-transcript";
import { MeetingReviewCard } from "./meeting-review-card";
import { MarkdownMessage } from "./markdown-message";
import { SparkIcon } from "./spark-icon";
import {
  listMyConversations,
  loadConversationMessages,
  renameConversation,
  deleteConversation,
} from "./actions";
import { NAVIGATE_ALLOWLIST_PREFIXES } from "@/domain/forge/navigate-allowlist";
import { ConversationList } from "./conversation-list";
import { useForgeImport, type ForgeImportResult } from "./use-forge-import";
import { ImportReviewLink } from "./import-review-link";

// Mirrors ScenarioDrawer's explicit width — the CSS slide transition needs a
// concrete translateX distance, so the px width can't live in Tailwind alone.
const PANEL_WIDTH = 420;

// NAVIGATE_ALLOWLIST_PREFIXES is imported from navigate-allowlist.ts above — the
// pure (LangChain-free) source of truth for the client-side nav guard (defence in
// depth; the server already gated the emit). custom-events.ts re-exports the same
// constant for server callers. Client MUST NOT import from custom-events (it's
// server-only — pulls @langchain/core / node:async_hooks into the browser bundle).

/**
 * Human-readable labels for tool names that appear in the status line.
 * Unmapped tools fall back to `deUnderscoreTool` below.
 */
const TOOL_LABELS: Record<string, string> = {
  run_monte_carlo: "Running a Monte Carlo simulation",
  run_projection: "Running the projection",
  explain_projection_change: "Explaining the change",
  break_down_projection_figure: "Breaking down the figure",
  client_briefing: "Reading the client overview",
  read_detail: "Reading the plan details",
  explain_report: "Reading the report data",
  open_page: "Opening the page",
  cite_page: "Finding the page to view",
  read_import: "Reading the import",
  extract_import: "Extracting import data",
  scan_book: "Scanning the document",
  search_planning_kb: "Searching the planning knowledge base",
  generate_report: "Generating the report",
  solve_goal: "Running the goal solver",
  solve_max_spending: "Running the spending solver",
  meeting_prep: "Preparing meeting notes",
};

/** Convert a snake_case tool name to a presentable label (e.g. "some_tool" → "Some tool"). */
function deUnderscoreTool(name: string): string {
  const words = name.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Resolve a toolStatus value to a human-readable label for the status line. */
function toolStatusLabel(status: string): string {
  if (status === "__working__") return "Working";
  return TOOL_LABELS[status] ?? deUnderscoreTool(status);
}

type Thread = { id: string; title: string; updatedAt?: Date | string };

interface ForgePanelProps {
  clientId: string | null;
  /** Household display name (e.g. "Jane & John Smith") for the context line. Optional in global mode. */
  clientName?: string;
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
  const walkthrough = useWalkthrough();
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
    pendingNavigate,
    setPendingNavigate,
    pendingWalkthrough,
    setPendingWalkthrough,
    send,
    cancel,
    resume,
    retry,
    retryAfterSeconds,
    pendingMeetingReview,
    resumeMeetingReview,
  } = useForgeStream(clientId);
  const router = useRouter();

  const [threads, setThreads] = useState<Thread[]>([]);
  const [input, setInput] = useState("");
  const [loadingThread, setLoadingThread] = useState(false);
  // The conversation-history list is collapsible so it never buries an active
  // chat. `null` = follow the default (open only when no conversation is
  // happening); a boolean = an explicit user toggle. Reset to null on
  // new-chat / thread-switch so the default takes over again.
  const [historyOverride, setHistoryOverride] = useState<boolean | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [attached, setAttached] = useState<File[]>([]);
  const [pendingImportId, setPendingImportId] = useState<string | undefined>();
  // A detected paste held for the ask-first prompt: { text, wordCount } or null.
  const [transcriptCandidate, setTranscriptCandidate] = useState<{ text: string; wordCount: number } | null>(null);
  const [showTranscriptPaste, setShowTranscriptPaste] = useState(false);
  const [transcriptPasteText, setTranscriptPasteText] = useState("");
  const [importResult, setImportResult] = useState<ForgeImportResult | null>(null);
  // After the advisor resolves an approval, keep a read-only receipt of the
  // decision in the thread (instead of the card vanishing) until the next turn.
  // Reload-from-history receipts are deferred (needs loadConversationMessages to
  // surface settled decisions).
  const [resolvedApproval, setResolvedApproval] = useState<
    (PendingApproval & { decisions: Record<string, "confirm" | "reject"> }) | null
  >(null);
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
  const locked = busy || pendingApproval != null || pendingMeetingReview != null || importing || transcriptCandidate != null;

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

  // Autofocus the composer when the panel opens (and again once it unlocks after
  // a turn) so the advisor can start typing immediately without a second click.
  // Guard on !locked — a disabled textarea can't take focus, and the composer is
  // locked while a stream/approval/import is in flight. The panel is `inert` when
  // closed, so focusing only makes sense once `open` is true (inert is already
  // gone by the time this post-commit effect runs).
  useEffect(() => {
    if (open && !locked) composerRef.current?.focus();
  }, [open, locked]);

  // Shared helper so all three refresh sites stay DRY.
  // Pass clientId directly: null (global mode) → SQL IS NULL filter;
  // string (client mode) → SQL eq filter. Never coerce null→undefined here
  // because undefined means "no filter" (returns all threads).
  function refetchThreads() {
    listMyConversations(clientId)
      .then((t) => setThreads(t as Thread[]))
      .catch(() => {});
  }

  // Load the thread list once the panel opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    listMyConversations(clientId)
      .then((t) => !cancelled && setThreads(t as Thread[]))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, clientId]);

  // Keep the latest bubble in view as it streams.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && typeof el.scrollTo === "function") {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, [messages, toolStatus, pendingApproval, loadingThread]);

  // Custom-streaming seam: consume a pending in-app navigation. Re-check the
  // allowlist client-side (defense in depth — the server already gates emit).
  // lastToolRender is intentionally NOT consumed yet: no renderer (plumbing only).
  useEffect(() => {
    if (!pendingNavigate) return;
    const ok = NAVIGATE_ALLOWLIST_PREFIXES.some((p) => pendingNavigate.startsWith(p));
    if (ok) router.push(pendingNavigate);
    setPendingNavigate(null);
  }, [pendingNavigate, router, setPendingNavigate]);

  // Custom-streaming seam: hand a requested walkthrough to the overlay provider,
  // then close the panel so the spotlight is unobstructed.
  useEffect(() => {
    if (!pendingWalkthrough) return;
    walkthrough.start(pendingWalkthrough);
    setPendingWalkthrough(null);
    close();
  }, [pendingWalkthrough, walkthrough, setPendingWalkthrough, close]);

  // Click handler for a page-citation chip. Re-check the allowlist client-side
  // (defence in depth — the server already gated the emit) before routing.
  const jumpToPage = useCallback(
    (href: string) => {
      if (NAVIGATE_ALLOWLIST_PREFIXES.some((p) => href.startsWith(p))) router.push(href);
    },
    [router],
  );

  // Clear the transcript-detection affordances (auto-detect banner + manual
  // paste box). Called on new-chat, thread-switch, and at the start of a
  // transcript submission so stale paste UI never bleeds across turns.
  function resetTranscriptState() {
    setTranscriptCandidate(null);
    setShowTranscriptPaste(false);
    setTranscriptPasteText("");
  }

  function newChat() {
    if (busy) return;
    setConversationId(undefined);
    setMessages([]);
    setPendingApproval(null);
    setResolvedApproval(null);
    setPendingImportId(undefined);
    setImportResult(null);
    setInput("");
    resetTranscriptState();
    setHistoryOverride(null);
  }

  async function processTranscript(text: string, source: "paste" | "explicit") {
    resetTranscriptState();
    const res = await fetch(`/api/clients/${clientId}/forge/transcript`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, conversationId, source }),
    });
    if (!res.ok) {
      setMessages((m) => [
        ...m,
        { role: "assistant", text: "I couldn't read that transcript. Please try again." },
      ]);
      return;
    }
    const { transcriptId } = (await res.json()) as { transcriptId: string };
    setMessages((m) => [
      ...m,
      { role: "user", text: "📄 Meeting transcript", attachments: ["Meeting transcript"] },
    ]);
    await send({
      message: "",
      scenarioId: scenarioId ?? "base",
      conversationId,
      currentPage: sectionKeyForPath(pathname),
      pendingTranscriptId: transcriptId,
      skipUserBubble: true,
    });
    refetchThreads();
  }

  async function selectThread(id: string) {
    if (busy || loadingThread || id === conversationId) return;
    // Let the history collapse back to its default once the thread loads.
    setHistoryOverride(null);
    setLoadingThread(true);
    setPendingApproval(null);
    setResolvedApproval(null);
    setPendingImportId(undefined);
    setImportResult(null);
    resetTranscriptState();
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
    // A new turn supersedes the prior approval receipt.
    setResolvedApproval(null);
    // Send-with-files: run the import pipeline, then immediately engage the agent.
    // Import is a client-only affordance; the attach button is hidden in global mode.
    if (attached.length > 0 && clientId != null) {
      const files = attached;
      const prompt = input.trim(); // may be empty — the attachment is the turn
      setAttached([]);
      setInput("");
      setImportResult(null); // clear any prior summary before a new run
      // Show the user's turn (with attachment chips) right away — the import
      // analysis below can take seconds, and we don't want the message to
      // vanish from the composer until it's done. send() is told to skip the
      // user bubble so it isn't duplicated.
      setMessages((m) => [
        ...m,
        { role: "user", text: prompt, attachments: files.map((f) => f.name) },
      ]);
      const result = await runImport(clientId, files);
      if (!result) return; // importError bubble already shown by the hook
      setPendingImportId(result.importId);
      setImportResult(result);
      // Fire one chat turn so Forge reads the import and responds right away.
      await send({
        message: prompt,
        scenarioId: scenarioId ?? "base",
        conversationId,
        currentPage: sectionKeyForPath(pathname),
        pendingImportId: result.importId,
        skipUserBubble: true,
      });
      refetchThreads();
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
    refetchThreads();
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
    // Hand the cursor straight to the composer so the advisor can type their
    // prompt without a second click. The picker button stole focus on open; the
    // composer is mounted and unlocked at attach time (no import/stream yet), so
    // focusing it is safe here.
    composerRef.current?.focus();
  }

  const lastMsg = messages[messages.length - 1];
  const streamingEmpty = busy && lastMsg?.role === "assistant" && lastMsg.text === "";
  // A conversation is "happening" once it has messages (or is loading one). In
  // that state the history list collapses by default so it doesn't push the
  // chat down; an explicit toggle (historyOverride) wins either way.
  const inConversation = messages.length > 0 || loadingThread;
  const showHistory = threads.length > 0 && (historyOverride ?? !inConversation);
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
            name, scenario, and a friendly page label (no raw IDs or route keys).
            In global mode (clientId == null) the client/scenario chips are hidden. */}
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 border-b border-hair px-4 py-2 text-[11px] text-ink-3">
          {clientId != null && clientName && (
            <>
              <span data-testid="chip-client" className="text-ink-2">{clientName}</span>
              <span aria-hidden className="text-ink-4">·</span>
            </>
          )}
          {clientId != null && (
            <>
              <span data-testid="chip-scenario" className="text-ink-2">{scenarioLabel}</span>
              <span aria-hidden className="text-ink-4">·</span>
            </>
          )}
          <span data-testid="chip-page" className="text-ink-2">{pageLabel}</span>
        </div>

        {/* Thread row */}
        <div className="flex flex-col gap-2 border-b border-hair px-4 py-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={newChat}
              disabled={busy}
              className="rounded-[var(--radius-sm)] border border-secondary/40 bg-secondary-wash px-2.5 py-1 text-[12px] font-medium text-secondary-ink hover:bg-secondary/20 disabled:opacity-50"
            >
              + New chat
            </button>
            {threads.length > 0 && (
              <button
                type="button"
                onClick={() => setHistoryOverride(!showHistory)}
                aria-expanded={showHistory}
                className="ml-auto flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-1 text-[12px] font-medium text-ink-3 hover:bg-card-hover hover:text-ink"
              >
                <svg
                  aria-hidden
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={`transition-transform ${showHistory ? "rotate-180" : ""}`}
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
                History
                <span className="text-ink-4">{threads.length}</span>
              </button>
            )}
          </div>
          {showHistory && (
            <ConversationList
              threads={threads}
              activeId={conversationId}
              onSelect={(id) => void selectThread(id)}
              onRename={async (id, title) => {
                // Optimistic local update
                const prev = threads;
                setThreads((ts) => ts.map((t) => (t.id === id ? { ...t, title } : t)));
                try {
                  await renameConversation(id, title);
                  refetchThreads();
                } catch {
                  // Revert on failure + refetch to restore server state
                  setThreads(prev);
                  refetchThreads();
                }
              }}
              onDelete={async (id) => {
                // Optimistic local removal
                setThreads((ts) => ts.filter((t) => t.id !== id));
                // If the deleted thread was active, start a new chat
                if (id === conversationId) newChat();
                try {
                  await deleteConversation(id);
                  refetchThreads();
                } catch {
                  refetchThreads();
                }
              }}
            />
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
              <div key={i} className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}>
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

                {!isUser && m.pageLinks && m.pageLinks.length > 0 && (
                  <div className="mt-1.5 max-w-[90%]" data-testid="page-links">
                    <div className="mb-1 text-[11px] text-secondary-ink/70">See this in the app</div>
                    <div className="flex flex-wrap gap-1.5">
                      {m.pageLinks.map((link) => (
                        <button
                          key={link.section}
                          type="button"
                          data-href={link.href}
                          onClick={() => jumpToPage(link.href)}
                          className="inline-flex items-center gap-1 rounded-full border border-secondary/40 bg-secondary/10 px-2.5 py-1 text-[12px] text-secondary-ink transition-colors hover:bg-secondary/20"
                        >
                          {link.label}
                          <span aria-hidden>→</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* Tool affordance — human-readable label (never raw snake_case identifiers). */}
          {toolStatus && (
            <div className="flex items-center gap-2 text-[12px] text-secondary-ink" aria-live="polite">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-secondary" />
              {toolStatusLabel(toolStatus)}…
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

          {importResult && clientId != null && (
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
              onSubmit={(decisions) => {
                setResolvedApproval({ ...pendingApproval, decisions });
                // A confirmed write COMMITS during the resume (the graph is
                // paused mid-interrupt; the tool only runs on /resume). The
                // host planning views (Net Worth, Inflows & Outflows, etc.) are
                // server components reading the DB, so nothing re-fetches on
                // its own — without this the advisor sees stale data (deleted
                // accounts still listed) until a manual page reload. Refresh
                // after the resume drains so those views reflect the change in
                // place. A reject-only resume mutates nothing, so skip it.
                const committed = Object.values(decisions).some((v) => v === "confirm");
                void Promise.resolve(resume(decisions)).then(() => {
                  if (committed) router.refresh();
                });
              }}
              onCancel={() => {
                const rejectAll: Record<string, "confirm" | "reject"> = {};
                for (const c of pendingApproval.calls) rejectAll[c.id] = "reject";
                setResolvedApproval({ ...pendingApproval, decisions: rejectAll });
                resume(rejectAll);
              }}
            />
          )}

          {/* Meeting review card — parallel to approval, rendered after it. */}
          {pendingMeetingReview && (
            <MeetingReviewCard
              review={pendingMeetingReview}
              busy={busy}
              onApprove={(payload) =>
                // Saving a meeting record commits a note + tasks + transcript
                // doc on approval; refresh so CRM/tasks views reflect it
                // without a manual reload (mirrors the approval path above).
                void Promise.resolve(resumeMeetingReview(payload)).then(() => {
                  if (payload.approved) router.refresh();
                })
              }
              onCancel={() =>
                void resumeMeetingReview({
                  approved: false,
                  summaryTitle: pendingMeetingReview.summaryTitle,
                  summary: pendingMeetingReview.summary,
                  meetingDate: pendingMeetingReview.meetingDate ?? new Date().toISOString().slice(0, 10),
                  tasks: [],
                })
              }
            />
          )}

          {/* Read-only receipt of the just-resolved approval (live path). */}
          {!pendingApproval && resolvedApproval && (
            <div data-testid="approval-receipt">
              <ApprovalCard
                previews={resolvedApproval.previews}
                calls={resolvedApproval.calls}
                busy={false}
                onSubmit={() => {}}
                onCancel={() => {}}
                resolved={resolvedApproval.calls.map((c) => ({
                  id: c.id,
                  choice: resolvedApproval.decisions[c.id] ?? "reject",
                }))}
              />
            </div>
          )}

          {status === "error" && errorMessage && (
            <div className="rounded-[var(--radius-sm)] border border-crit/40 bg-crit/10 px-3 py-2 text-[12px] text-crit">
              {errorMessage}
              {retryAfterSeconds != null && (
                <span className="ml-1">— try again in ~{retryAfterSeconds}s</span>
              )}
              {pendingApproval == null && (
                <button
                  type="button"
                  onClick={() => void retry()}
                  className="ml-2 rounded-[var(--radius-sm)] border border-crit/40 px-2 py-0.5 text-[11px] font-medium hover:bg-crit/20"
                >
                  Retry
                </button>
              )}
            </div>
          )}
        </div>

        {/* Composer — extra bottom padding keeps the input off the viewport
            edge so it doesn't sit flush with the app footer behind the panel. */}
        <div className="border-t border-hair px-4 pt-3 pb-6">
          {/* Ask-first prompt: shown when a pasted transcript is detected */}
          {transcriptCandidate && (
            <div className="mb-2 rounded-[var(--radius)] border border-hair bg-card-2 px-3 py-2.5">
              <p className="mb-2 text-[12px] text-ink-2">
                This looks like a meeting transcript (~{transcriptCandidate.wordCount.toLocaleString()} words).
                Summarize it and draft follow-up tasks?
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void processTranscript(transcriptCandidate.text, "paste")}
                  className="rounded-[var(--radius-sm)] bg-accent px-2.5 py-1 text-[12px] font-medium text-accent-on"
                >
                  Yes, summarize
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setInput((v) => v + transcriptCandidate.text);
                    setTranscriptCandidate(null);
                    composerRef.current?.focus();
                  }}
                  className="rounded-[var(--radius-sm)] border border-hair px-2.5 py-1 text-[12px] text-ink-3 hover:text-ink"
                >
                  No, just paste it
                </button>
              </div>
            </div>
          )}

          {/* Explicit transcript paste affordance */}
          {showTranscriptPaste && (
            <div className="mb-2 rounded-[var(--radius)] border border-hair bg-card-2 px-3 py-2.5">
              <p className="mb-1.5 text-[11px] font-medium text-ink-3">Paste a meeting transcript</p>
              <textarea
                aria-label="Paste transcript here"
                rows={4}
                value={transcriptPasteText}
                onChange={(e) => setTranscriptPasteText(e.target.value)}
                placeholder="Paste transcript text here…"
                className="mb-2 w-full resize-y rounded-[var(--radius-sm)] border border-hair bg-card px-2 py-1 text-[12px] text-ink placeholder:text-ink-4 focus:outline-none"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (transcriptPasteText.trim()) {
                      void processTranscript(transcriptPasteText, "explicit");
                    }
                  }}
                  disabled={!transcriptPasteText.trim()}
                  className="rounded-[var(--radius-sm)] bg-accent px-2.5 py-1 text-[12px] font-medium text-accent-on disabled:opacity-40"
                >
                  Summarize
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowTranscriptPaste(false);
                    setTranscriptPasteText("");
                  }}
                  className="rounded-[var(--radius-sm)] border border-hair px-2.5 py-1 text-[12px] text-ink-3 hover:text-ink"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

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
            accept=".pdf,.docx,.xlsx,.xls,.csv,.png,.jpg,.jpeg"
            className="hidden"
            onChange={(e) => {
              onPickFiles(e.target.files);
              e.target.value = ""; // allow re-selecting the same file
            }}
          />
          <div className="flex items-end gap-2 rounded-[var(--radius)] border border-hair bg-card-2 p-1.5 focus-within:border-secondary/50">
            {/* Attach button — client-only (imports require a client context). */}
            {clientId != null && (
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
            )}
            {/* Explicit transcript affordance — client-only (transcript tools need a client context). */}
            {clientId != null && (
              <button
                type="button"
                onClick={() => setShowTranscriptPaste((v) => !v)}
                disabled={locked}
                aria-label="Paste a meeting transcript"
                aria-pressed={showTranscriptPaste}
                className="flex h-8 shrink-0 items-center justify-center gap-1 rounded-[var(--radius-sm)] border border-hair px-2 text-[11px] text-ink-3 hover:text-ink disabled:opacity-40"
              >
                {/* Inline doc-text icon */}
                <svg
                  aria-hidden
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M14 3v4a1 1 0 0 0 1 1h4" />
                  <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" />
                  <line x1="9" y1="13" x2="15" y2="13" />
                  <line x1="9" y1="17" x2="13" y2="17" />
                </svg>
                Transcript
              </button>
            )}
            <textarea
              ref={composerRef}
              aria-label="Ask Forge"
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPaste={(e) => {
                if (locked) return;
                // Screenshots first: image clipboard items become attachments
                // (client context only — imports require a client). Renamed
                // because clipboard images all arrive as generic "image.png",
                // which reads as noise in the review wizard.
                const images = Array.from(e.clipboardData.files ?? []).filter(
                  (f) => f.type === "image/png" || f.type === "image/jpeg",
                );
                if (images.length > 0 && clientId != null) {
                  e.preventDefault();
                  setAttached((prev) => [
                    ...prev,
                    ...images.map((f, i) => {
                      const ext = f.type === "image/png" ? "png" : "jpg";
                      return new File([f], `screenshot-${prev.length + i + 1}.${ext}`, {
                        type: f.type,
                      });
                    }),
                  ]);
                  return;
                }
                const text = e.clipboardData.getData("text");
                const { isCandidate, wordCount } = looksLikeTranscript(text);
                if (isCandidate) {
                  e.preventDefault(); // keep the big text OUT of the composer
                  setTranscriptCandidate({ text, wordCount });
                }
              }}
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

