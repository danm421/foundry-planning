import { useEffect, useRef } from "react";
import type { ChatTurn } from "@/lib/statement-chat/state";

export interface ChatTranscriptProps {
  transcript: ChatTurn[];
}

function rowClassName(role: ChatTurn["role"]): string {
  if (role === "user") return "flex justify-end";
  if (role === "tool") return "flex justify-center";
  return "flex justify-start";
}

/**
 * Renders `ChatState.transcript` (Task 11b, Step 1) exactly as it was
 * hydrated on mount or appended from a turn response (C1/C2) — never a
 * client-composed string. The advisor's own messages align right, the
 * assistant's replies align left, and a tool call renders as a quiet
 * centered note rather than a bubble: it isn't conversation, it's a record
 * of what changed.
 *
 * The scrollable region lives HERE, on the `<ul>` itself (Minor 9, Task 11b
 * fix round 1) — not on a second wrapping `<div>` in `chat-surface.tsx`,
 * which used to nest two `overflow-y-auto` containers. Auto-scrolls to the
 * newest entry on every change: without it, Step 3's "the advisor must
 * never be left wondering whether the question was heard" fails silently
 * once the history is a few messages deep — the answer lands below the
 * fold and nothing moves to show it arrived.
 */
export function ChatTranscript({ transcript }: ChatTranscriptProps) {
  const scrollRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [transcript]);

  if (transcript.length === 0) {
    return (
      <p className="px-3 py-6 text-center text-sm text-ink-3">
        Ask a question about these statements to get started.
      </p>
    );
  }

  return (
    <ul
      ref={scrollRef}
      className="flex max-h-72 flex-col gap-2 overflow-y-auto p-3"
      aria-live="polite"
    >
      {transcript.map((turn, i) => (
        <li key={i} className={rowClassName(turn.role)}>
          {turn.role === "tool" ? (
            <span className="max-w-[85%] text-xs text-ink-3">
              <span className="font-medium text-ink-4">Used {turn.tool}</span> — {turn.summary}
            </span>
          ) : (
            <span
              className={
                "max-w-[85%] whitespace-pre-wrap rounded-[var(--radius-sm)] border border-hair px-3 py-2 text-sm text-ink " +
                (turn.role === "user" ? "bg-card-2" : "bg-card")
              }
            >
              {turn.text}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
