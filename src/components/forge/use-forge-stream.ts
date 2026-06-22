// src/components/forge/use-forge-stream.ts
//
// Client-side SSE consumer for the Forge stream/resume routes. Adapts the
// boundary-correct chunk parser from use-solver-solve.ts: the forge route
// emits `data:`-only frames (no `event:` line), each a JSON object tagged by
// `type`. The hook accumulates streamed tokens into the trailing assistant
// bubble, tracks tool-run status for "Running Monte Carlo…" affordances, and
// captures any approval payload (rendered by the Phase-2 ApprovalCard).

"use client";

import { useCallback, useRef, useState } from "react";

// ---- SSE event union (server → client). Mirrors the fixed SSE contract. ----
export interface WritePreview {
  summary: string;
  name: string;
  details?: string[];
}
export interface ApprovalCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}
export type ForgeSseEvent =
  | { type: "conversation"; conversationId: string }
  | { type: "token"; text: string }
  | { type: "tool_start"; name: string }
  | { type: "tool_end"; name: string }
  // Structured custom-streaming frames (plumbing only — no renderer yet).
  | { type: "tool_render"; name: string; status: "inProgress" | "complete"; data: unknown }
  | { type: "navigate"; href: string }
  | { type: "activity"; label: string }
  | { type: "approval_required"; previews: WritePreview[]; calls: ApprovalCall[] }
  | { type: "verifying" }
  | { type: "done" }
  | { type: "error"; message: string };

export interface PendingApproval {
  previews: WritePreview[];
  calls: ApprovalCall[];
}
export type ForgeChatRole = "user" | "assistant";
export interface ForgeMessage {
  role: ForgeChatRole;
  text: string;
  /** Display-only filenames shown as chips on a user bubble (chat attachments). */
  attachments?: string[];
}
export type ForgeStatus = "idle" | "streaming" | "done" | "error" | "cancelled";

/**
 * Parse `data:`-only SSE frames (`data: <json>\n\n`) into the typed event
 * union. Stateless generator over a buffer: yields each complete frame and
 * RETURNS the trailing partial frame so the caller can carry it into the next
 * chunk. Adapted from `parseSseStream` in use-solver-solve.ts (which keyed on
 * an `event:` line — the forge protocol has none, so we key on the JSON
 * `type`).
 */
export function* parseForgeSse(buffer: string): Generator<ForgeSseEvent, string> {
  let cursor = 0;
  for (;;) {
    const boundary = buffer.indexOf("\n\n", cursor);
    if (boundary === -1) {
      return buffer.slice(cursor);
    }
    const block = buffer.slice(cursor, boundary);
    cursor = boundary + 2;
    let data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("data: ")) data += line.slice("data: ".length);
    }
    if (data) {
      try {
        yield JSON.parse(data) as ForgeSseEvent;
      } catch {
        // A malformed frame shouldn't kill the stream; skip it.
      }
    }
  }
}

export interface SendArgs {
  message: string;
  scenarioId: string;
  conversationId?: string;
  currentPage?: string;
  /** When set, tells the forge a freshly-uploaded import is awaiting review. */
  pendingImportId?: string;
  /** Display-only filenames to show on the user bubble; never sent to the server. */
  attachments?: string[];
  /**
   * Skip pushing the user bubble — the caller already showed it (e.g. the
   * attachment path renders the turn before the import runs so it appears
   * immediately). When true, `send` only pushes the empty assistant bubble.
   */
  skipUserBubble?: boolean;
}

export interface UseForgeStreamResult {
  messages: ForgeMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ForgeMessage[]>>;
  streamingText: string;
  toolStatus: string | null;
  /** Latest structured render frame (custom-streaming seam; no renderer yet). */
  lastToolRender: Extract<ForgeSseEvent, { type: "tool_render" }> | null;
  /** Pending in-app navigation the panel may consume + clear. */
  pendingNavigate: string | null;
  setPendingNavigate: React.Dispatch<React.SetStateAction<string | null>>;
  isVerifying: boolean;
  pendingApproval: PendingApproval | null;
  setPendingApproval: React.Dispatch<React.SetStateAction<PendingApproval | null>>;
  status: ForgeStatus;
  errorMessage: string | null;
  conversationId: string | undefined;
  setConversationId: React.Dispatch<React.SetStateAction<string | undefined>>;
  /** POST a turn and stream the reply into the trailing assistant bubble. */
  send: (args: SendArgs) => Promise<void>;
  cancel: () => void;
  /** Re-POST the last user turn on the same conversation + scenario after a failed/cancelled turn. */
  retry: () => Promise<void>;
  /**
   * Seconds to wait before retrying, parsed from a `Retry-After` header on a
   * 429/503 response. `null` when no countdown applies. Cleared at the top of
   * every `send`.
   */
  retryAfterSeconds: number | null;
  /** Resume an interrupted conversation after the advisor submits approval decisions. */
  resume: (decisions: Record<string, "confirm" | "reject">) => Promise<void>;
}

export function useForgeStream(clientId: string): UseForgeStreamResult {
  const [messages, setMessages] = useState<ForgeMessage[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const [toolStatus, setToolStatus] = useState<string | null>(null);
  // Custom-streaming seam: stash the latest structured frame for a future
  // renderer (no UI yet) + a pending in-app navigation the panel may consume.
  const [lastToolRender, setLastToolRender] = useState<
    Extract<ForgeSseEvent, { type: "tool_render" }> | null
  >(null);
  const [pendingNavigate, setPendingNavigate] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [status, setStatus] = useState<ForgeStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [retryAfterSeconds, setRetryAfterSeconds] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Scenario of the in-flight/last turn, so `retry` resends against the same one.
  const lastScenarioRef = useRef<string>("base");
  // Mirror of `status` for synchronous reads in callbacks (avoids a stale closure
  // without a setStatus-updater side effect).
  const statusRef = useRef<ForgeStatus>("idle");
  statusRef.current = status;

  // Strip an orphaned empty assistant bubble (error/cancel) or, on cancel,
  // annotate a partial bubble so the user sees the turn was stopped. Called
  // from the failure paths in `send`/`cancel`.
  const finalizeFailedAssistantBubble = useCallback((mode: "error" | "cancel") => {
    setMessages((m) => {
      if (m.length === 0) return m;
      const copy = [...m];
      const last = copy[copy.length - 1];
      if (last.role !== "assistant") return copy;
      if (last.text === "") {
        copy.pop(); // drop the orphaned empty bubble
      } else if (mode === "cancel") {
        copy[copy.length - 1] = { ...last, text: `${last.text} (stopped)` };
      }
      return copy;
    });
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    // Only annotate/strip when we actually interrupted a streaming turn —
    // `send` calls cancel() at its top to abort any prior stream, and that
    // turn's bubble is already finalized.
    if (statusRef.current === "streaming") {
      finalizeFailedAssistantBubble("cancel");
      setToolStatus(null);
      setStatus("cancelled");
    }
  }, [finalizeFailedAssistantBubble]);

  const applyEvent = useCallback((ev: ForgeSseEvent) => {
    switch (ev.type) {
      case "conversation":
        setConversationId(ev.conversationId);
        break;
      case "verifying":
        setIsVerifying(true);
        break;
      case "token":
        setIsVerifying(false);
        // Clear the between-tools sentinel before appending the token.
        setToolStatus(null);
        // Append to the trailing assistant bubble (created by `send` before fetch).
        setMessages((m) => {
          if (m.length === 0) return m;
          const copy = [...m];
          const last = copy[copy.length - 1];
          if (last.role === "assistant") {
            copy[copy.length - 1] = { role: "assistant", text: last.text + ev.text };
          }
          return copy;
        });
        setStreamingText((t) => t + ev.text);
        break;
      case "tool_start":
        setToolStatus(ev.name);
        break;
      case "tool_end":
        // Set sentinel instead of null so the status line shows "Working…"
        // between a tool completing and the next token arriving (no blank flicker).
        setToolStatus("__working__");
        break;
      case "tool_render":
        // Plumbing only: stash the payload for a future renderer. No UI yet.
        setLastToolRender(ev);
        break;
      case "navigate":
        setPendingNavigate(ev.href);
        break;
      case "activity":
        setToolStatus(ev.label);
        break;
      case "approval_required":
        setPendingApproval({ previews: ev.previews, calls: ev.calls });
        break;
      case "error":
        setIsVerifying(false);
        setToolStatus(null);
        setStatus("error");
        setErrorMessage(ev.message);
        break;
      case "done":
        // Clear the sentinel so "Working…" doesn't persist after the turn ends.
        setToolStatus(null);
        break;
    }
  }, []);

  // ---------------------------------------------------------------------------
  // consumeStream — shared SSE reader used by both `send` and `resume`.
  // Reads chunks from `res.body`, runs parseForgeSse + applyEvent on each
  // complete frame, and sets status to "done" when the stream drains normally.
  // Aborts and error paths are handled by the caller's try/catch (each caller
  // owns its own AbortController).
  // ---------------------------------------------------------------------------
  const consumeStream = useCallback(
    async (res: Response) => {
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const it = parseForgeSse(buffer);
        let next = it.next();
        while (!next.done) {
          applyEvent(next.value);
          next = it.next();
        }
        buffer = next.value as string;
      }
      // Only advance to "done" if we haven't already been set to an error/cancel
      // state by an applyEvent("error") call mid-stream.
      setStatus((s) => (s === "streaming" ? "done" : s));
    },
    [applyEvent],
  );

  const send = useCallback(
    async (args: SendArgs) => {
      cancel();
      const ac = new AbortController();
      abortRef.current = ac;
      lastScenarioRef.current = args.scenarioId;
      setStatus("streaming");
      setErrorMessage(null);
      setRetryAfterSeconds(null);
      setStreamingText("");
      setToolStatus(null);
      setIsVerifying(false);
      // Push the user turn (unless the caller already showed it) + an empty
      // assistant bubble to stream into.
      setMessages((m) => {
        const next = [...m];
        if (!args.skipUserBubble) {
          next.push({ role: "user", text: args.message, attachments: args.attachments });
        }
        next.push({ role: "assistant", text: "" });
        return next;
      });

      let res: Response;
      try {
        res = await fetch(`/api/clients/${clientId}/forge/stream`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            message: args.message,
            scenarioId: args.scenarioId,
            conversationId: args.conversationId ?? conversationId,
            currentPage: args.currentPage,
            pendingImportId: args.pendingImportId,
          }),
          signal: ac.signal,
        });
      } catch (err) {
        // An aborted fetch was already finalized by cancel(); don't re-annotate.
        if (ac.signal.aborted) return;
        const msg = err instanceof Error ? err.message : String(err);
        setStatus("error");
        setErrorMessage(msg);
        finalizeFailedAssistantBubble("error");
        return;
      }

      if (!res.ok || !res.body) {
        // 503 = rate-limit (fails closed). Show the route's plaintext body so
        // the user sees "temporarily unavailable", not a stuck spinner.
        const text = await res.text().catch(() => "");
        const msg =
          res.status === 503
            ? text || "Forge is temporarily unavailable (rate limited). Try again shortly."
            : text || `Request failed (HTTP ${res.status}).`;
        // Surface a Retry-After countdown on rate-limit responses (429/503).
        if (res.status === 429 || res.status === 503) {
          const ra = Number(res.headers.get("retry-after"));
          setRetryAfterSeconds(Number.isFinite(ra) && ra > 0 ? ra : null);
        }
        setStatus("error");
        setErrorMessage(msg);
        finalizeFailedAssistantBubble("error");
        return;
      }

      try {
        await consumeStream(res);
        // A2 may end the stream with an `error` frame (optionally preceded by a
        // flushed-buffer token). consumeStream leaves status === "error" in that
        // case; drop a still-empty trailing bubble so no blank reply is stranded.
        if (statusRef.current === "error") finalizeFailedAssistantBubble("error");
      } catch (err) {
        // An aborted fetch was already finalized by cancel(); don't re-annotate.
        if (ac.signal.aborted) return;
        const msg = err instanceof Error ? err.message : String(err);
        setStatus("error");
        setErrorMessage(msg);
        finalizeFailedAssistantBubble("error");
      }
    },
    [clientId, conversationId, cancel, consumeStream, finalizeFailedAssistantBubble],
  );

  const resume = useCallback(
    async (decisions: Record<string, "confirm" | "reject">) => {
      if (!conversationId) return; // nothing to resume
      setPendingApproval(null); // optimistic clear so the card unmounts
      setStatus("streaming");
      setErrorMessage(null);
      setIsVerifying(false);
      // Push an empty assistant bubble to stream the response into,
      // matching the same shape `send` uses so the renderer is consistent.
      setMessages((m) => [...m, { role: "assistant", text: "" }]);
      const ac = new AbortController();
      abortRef.current = ac;
      try {
        const res = await fetch(`/api/clients/${clientId}/forge/resume`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ conversationId, decisions }),
          signal: ac.signal,
        });
        if (!res.ok || !res.body) {
          const text = await res.text().catch(() => "");
          setStatus("error");
          setErrorMessage(text || `HTTP ${res.status}`);
          return;
        }
        await consumeStream(res);
      } catch (err) {
        if (ac.signal.aborted) {
          setStatus("cancelled");
          return;
        }
        setStatus("error");
        setErrorMessage(err instanceof Error ? err.message : String(err));
      }
    },
    [clientId, conversationId, consumeStream],
  );

  // Re-POST the last user turn after a failed/cancelled turn, on the same
  // conversation + scenario. Used by the panel's Retry affordance (Task A4).
  const retry = useCallback(async () => {
    const lastUser = [...messages].reverse().find((x) => x.role === "user");
    if (!lastUser) return;
    await send({
      message: lastUser.text,
      scenarioId: lastScenarioRef.current,
      conversationId,
    });
  }, [messages, conversationId, send]);

  return {
    messages,
    setMessages,
    streamingText,
    toolStatus,
    lastToolRender,
    pendingNavigate,
    setPendingNavigate,
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
    retry,
    retryAfterSeconds,
  };
}
