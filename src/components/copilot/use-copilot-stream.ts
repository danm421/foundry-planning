// src/components/copilot/use-copilot-stream.ts
//
// Client-side SSE consumer for the Copilot stream/resume routes. Adapts the
// boundary-correct chunk parser from use-solver-solve.ts: the copilot route
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
export type CopilotSseEvent =
  | { type: "conversation"; conversationId: string }
  | { type: "token"; text: string }
  | { type: "tool_start"; name: string }
  | { type: "tool_end"; name: string }
  | { type: "approval_required"; previews: WritePreview[]; calls: ApprovalCall[] }
  | { type: "done" }
  | { type: "error"; message: string };

export interface PendingApproval {
  previews: WritePreview[];
  calls: ApprovalCall[];
}
export type CopilotChatRole = "user" | "assistant";
export interface CopilotMessage {
  role: CopilotChatRole;
  text: string;
}
export type CopilotStatus = "idle" | "streaming" | "done" | "error" | "cancelled";

/**
 * Parse `data:`-only SSE frames (`data: <json>\n\n`) into the typed event
 * union. Stateless generator over a buffer: yields each complete frame and
 * RETURNS the trailing partial frame so the caller can carry it into the next
 * chunk. Adapted from `parseSseStream` in use-solver-solve.ts (which keyed on
 * an `event:` line — the copilot protocol has none, so we key on the JSON
 * `type`).
 */
export function* parseCopilotSse(buffer: string): Generator<CopilotSseEvent, string> {
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
        yield JSON.parse(data) as CopilotSseEvent;
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
  /** When set, tells the copilot a freshly-uploaded import is awaiting review. */
  pendingImportId?: string;
}

export interface UseCopilotStreamResult {
  messages: CopilotMessage[];
  setMessages: React.Dispatch<React.SetStateAction<CopilotMessage[]>>;
  streamingText: string;
  toolStatus: string | null;
  pendingApproval: PendingApproval | null;
  setPendingApproval: React.Dispatch<React.SetStateAction<PendingApproval | null>>;
  status: CopilotStatus;
  errorMessage: string | null;
  conversationId: string | undefined;
  setConversationId: React.Dispatch<React.SetStateAction<string | undefined>>;
  /** POST a turn and stream the reply into the trailing assistant bubble. */
  send: (args: SendArgs) => Promise<void>;
  cancel: () => void;
  /** Resume an interrupted conversation after the advisor submits approval decisions. */
  resume: (decisions: Record<string, "confirm" | "reject">) => Promise<void>;
}

export function useCopilotStream(clientId: string): UseCopilotStreamResult {
  const [messages, setMessages] = useState<CopilotMessage[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const [toolStatus, setToolStatus] = useState<string | null>(null);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [status, setStatus] = useState<CopilotStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setStatus((s) => (s === "streaming" ? "cancelled" : s));
  }, []);

  const applyEvent = useCallback((ev: CopilotSseEvent) => {
    switch (ev.type) {
      case "conversation":
        setConversationId(ev.conversationId);
        break;
      case "token":
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
        setToolStatus(null);
        break;
      case "approval_required":
        setPendingApproval({ previews: ev.previews, calls: ev.calls });
        break;
      case "error":
        setStatus("error");
        setErrorMessage(ev.message);
        break;
      case "done":
        // terminal — handled by the read loop completing.
        break;
    }
  }, []);

  // ---------------------------------------------------------------------------
  // consumeStream — shared SSE reader used by both `send` and `resume`.
  // Reads chunks from `res.body`, runs parseCopilotSse + applyEvent on each
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
        const it = parseCopilotSse(buffer);
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
      setStatus("streaming");
      setErrorMessage(null);
      setStreamingText("");
      setToolStatus(null);
      // Push the user turn + an empty assistant bubble to stream into.
      setMessages((m) => [
        ...m,
        { role: "user", text: args.message },
        { role: "assistant", text: "" },
      ]);

      let res: Response;
      try {
        res = await fetch(`/api/clients/${clientId}/copilot/stream`, {
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
        if (ac.signal.aborted) return setStatus("cancelled");
        const msg = err instanceof Error ? err.message : String(err);
        setStatus("error");
        setErrorMessage(msg);
        return;
      }

      if (!res.ok || !res.body) {
        // 503 = rate-limit (fails closed). Show the route's plaintext body so
        // the user sees "temporarily unavailable", not a stuck spinner.
        const text = await res.text().catch(() => "");
        const msg =
          res.status === 503
            ? text || "Copilot is temporarily unavailable (rate limited). Try again shortly."
            : text || `Request failed (HTTP ${res.status}).`;
        setStatus("error");
        setErrorMessage(msg);
        return;
      }

      try {
        await consumeStream(res);
      } catch (err) {
        if (ac.signal.aborted) return setStatus("cancelled");
        const msg = err instanceof Error ? err.message : String(err);
        setStatus("error");
        setErrorMessage(msg);
      }
    },
    [clientId, conversationId, cancel, consumeStream],
  );

  const resume = useCallback(
    async (decisions: Record<string, "confirm" | "reject">) => {
      if (!conversationId) return; // nothing to resume
      setPendingApproval(null); // optimistic clear so the card unmounts
      setStatus("streaming");
      setErrorMessage(null);
      // Push an empty assistant bubble to stream the response into,
      // matching the same shape `send` uses so the renderer is consistent.
      setMessages((m) => [...m, { role: "assistant", text: "" }]);
      const ac = new AbortController();
      abortRef.current = ac;
      try {
        const res = await fetch(`/api/clients/${clientId}/copilot/resume`, {
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

  return {
    messages,
    setMessages,
    streamingText,
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
  };
}
