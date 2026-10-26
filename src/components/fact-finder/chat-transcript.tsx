"use client";
// src/components/fact-finder/chat-transcript.tsx
// The fact finder chat as saved: the advisor's messages, each change a reply
// made (in the words the server wrote), and the replies, each with Undo while
// the server still keeps what it changed. No height of its own: the side
// panel's body is the one place that scrolls.
import { useEffect, useRef } from "react";
import type { FactFinderState, FFChatTurn } from "@/lib/fact-finder/types";
import { LoaderIcon, UndoIcon } from "./icons";

const BUBBLE =
  "max-w-[85%] whitespace-pre-wrap break-words rounded-[var(--radius-sm)] border border-hair px-3 py-2 text-sm text-ink";
const UNDO_CLASS =
  "inline-flex items-center gap-1.5 rounded border border-hair px-2.5 py-1 text-xs font-medium text-accent transition-colors enabled:hover:border-accent enabled:hover:bg-accent-wash enabled:hover:text-accent-ink disabled:cursor-not-allowed disabled:text-ink-4";

export interface ChatTranscriptProps {
  transcript: FFChatTurn[];
  /** Undo snapshots by reply id: a reply listed here can be undone. */
  undoable: FactFinderState["undo"];
  /** The message on its way, shown until its reply lands. */
  pending: string | null;
  /** The reply being undone. */
  undoing: string | null;
  onUndo: (turnId: string) => void;
}

export function ChatTranscript({ transcript, undoable, pending, undoing, onUndo }: ChatTranscriptProps) {
  const listRef = useRef<HTMLUListElement>(null);
  const shown = transcript.length + (pending === null ? 0 : 1);
  const lastShown = useRef(shown);
  const busy = pending !== null || undoing !== null;

  // A new message or reply comes into view; opening the panel doesn't jump.
  useEffect(() => {
    if (shown > lastShown.current) listRef.current?.lastElementChild?.scrollIntoView?.({ block: "nearest" });
    lastShown.current = shown;
  }, [shown]);

  if (shown === 0) {
    return <p className="text-sm text-ink-3">Ask a question about this fact finder, or say what to change.</p>;
  }

  return (
    <ul ref={listRef} aria-live="polite" className="flex flex-col gap-2">
      {transcript.map((turn) => {
        if (turn.role === "user") {
          return (
            <li key={turn.id} className="flex justify-end">
              <p className={`${BUBBLE} bg-card-2`}>{turn.text}</p>
            </li>
          );
        }
        if (turn.role === "tool") {
          return (
            <li key={turn.id} className="flex justify-start">
              <p className="max-w-[85%] break-words border-l-2 border-hair-2 pl-2.5 text-xs text-ink-3">{turn.summary}</p>
            </li>
          );
        }
        if (turn.role === "proposal") return null;
        const textId = `chat-turn-${turn.id}`;
        return (
          <li key={turn.id} className="flex flex-col items-start gap-1.5">
            <p id={textId} className={`${BUBBLE} bg-card`}>
              {turn.text}
            </p>
            {Object.hasOwn(undoable, turn.id) && (
              <button
                type="button"
                disabled={busy}
                aria-describedby={textId}
                onClick={() => onUndo(turn.id)}
                className={UNDO_CLASS}
              >
                <UndoIcon className="h-3.5 w-3.5" />
                {undoing === turn.id ? "Undoing…" : "Undo"}
              </button>
            )}
          </li>
        );
      })}
      {pending !== null && (
        <li className="flex flex-col items-end gap-1.5">
          <p className={`${BUBBLE} bg-card-2`}>{pending}</p>
          <p className="flex items-center gap-2 self-start text-xs text-ink-3">
            <LoaderIcon className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
            Working on it…
          </p>
        </li>
      )}
    </ul>
  );
}
